# CLAUDE.md — Conferência de lançamentos (`application/declarados`)

A nota recebida vira despesa, o débito do extrato vira o pagamento dela, e o contador confirma.

**Ler antes de mexer.** Quase tudo aqui veio de medição em produção ou de instrução literal do dono.

## O que é um "declarado"

Um **fato de despesa que ainda não é lançamento contábil**. Nasce de três lugares — uma nota
recebida, o cliente digitando no portal, um débito do extrato — e só vira `AccountingEntry` quando
o contador confirma.

## ⚠⚠ A INVARIANTE DO CAIXA — é o eixo do módulo inteiro

**Medido** (`scripts/diag-forma-despesa.mjs`, 24/08/2026), sobre os **155** lançamentos
`tipo: "DESPESA"` que já existem em produção:

| | |
|---|---|
| pernas | **155/155 são `1D / 1C`** — partida dobrada completa, nunca perna única |
| ⚠⚠ conta a crédito | **`5` CAIXA - MATRIZ (`1.1.1.01.0001`), em 155 de 155.** Nunca fornecedor |
| `eventType` / `subtipo` | nulos em 155/155 |
| `status` / `statusPagamento` | `RASCUNHO` / `NA` em 155/155 |
| histórico (os 130 do Excel) | **o nome do fornecedor cru** — `"KODA BEAR"`, `"GOOGLE CLOUD BRASIL…"` |
| concentração | **153 das 155 são da SINTROPIA** |

**Ou seja: o lançamento de despesa desta casa AFIRMA A SAÍDA DO DINHEIRO.**

A nota recebida **não sabe quando o dinheiro saiu**. Lançá-la na data de emissão mentiria sobre o
caixa em toda despesa a prazo — e mentiria **em silêncio**, que é o pior modo. Por isso existe o
estado `AGUARDANDO_PAGAMENTO`: enquanto a data não for conhecida, essa é a resposta honesta.

⚠ **A tentação a resistir** é preencher a data com a emissão, ou com "hoje", para o fluxo "não
travar". As duas gravam uma afirmação falsa sobre quando a empresa pagou.

## ⚠⚠ E ELE NÃO É PRISÃO — decisão do dono, 24/08/2026

> *"o contador pode decidir colocar aquela nota como despesa naquele momento, mesmo sem
> comprovante."*

Ele confirma direto de `AGUARDANDO_PAGAMENTO`, informando a data no mesmo ato. O que se grava é
**de onde a data veio**:

| | prova | declaração |
|---|---|---|
| `origemPagamento` | `OFX` | **`DECLARADO_PELO_CONTADOR`** |
| a tela | neutro | diz que é **declaração, não prova** |

⚠ Mesma disciplina da **baixa manual de parcela**, que já grava `origemBaixa: "MANUAL"` e escreve
"(declarado)" no histórico — *"o contador precisa saber qual das duas está fazendo"*.

⚠ **O atalho NÃO afrouxa a invariante:** sem a data, a recusa é exatamente a mesma.

## ⚠⚠ UM REGISTRO POR DESPESA

A nota e o pagamento são duas **faces** da mesma linha, nunca duas linhas. É isso que torna a
**contagem dupla impossível por construção**, em vez de ser regra que alguém pode furar.

Quando o débito do extrato casar com uma nota, ele **preenche o bloco de pagamento** do declarado
que já existe. Não nasce registro novo. (O matching é da Fase B2; o modelo já o comporta.)

## Os arquivos

| | |
|---|---|
| `lib/estadosDeclarado.js` | a máquina de estados. **PURA** — nenhum prisma, nenhum relógio. 70 testes |
| `lib/formaDoLancamento.js` | o `AccountingEntry` que o declarado vira. **PURO**. 32 testes |
| `lib/notaViraDeclarado.js` | a nota recebida virando despesa. **PURO**. 36 testes |
| `lib/dedupeOfx.js` | a **identidade** de uma transação do extrato. **PURO**. 25 testes |
| `lib/casamentoPagamento.js` | o débito do extrato pagou esta nota? **PURO**. 28 testes |
| `DeclaradoService.js` | a ligação com o banco. **O único caminho de escrita.** 66 testes |
| `VarreduraDeNotasService.js` | a varredura das notas. 16 testes |
| `ImportOfxService.js` | o extrato do cliente virando fila. 22 testes |
| `lib/mapeamentoDoExtrato.js` | qual coluna é o quê num extrato em Excel. **PURO**. 38 testes |
| `lib/lerPlanilhaExtrato.js` | do arquivo .xlsx às linhas cruas. **PURO** |
| `ImportExcelExtratoService.js` | o extrato em Excel virando fila. 23 testes |
| `MapeamentoExtratoService.js` | o mapeamento no banco. **A única porta que liga `confirmado`.** 15 testes |
| `../accounting/lib/ofx.js` | ler o arquivo OFX. ⚠ **extraído**, não reescrito — ver B2 |
| `../../routes/firm/conferencia.js` | HTTP do contador, e nada mais. 50 testes |
| `../../routes/client/index.js` | HTTP do cliente (o import). 17 testes de montagem |

⚠ **A regra não é reimplementada em lugar nenhum.** O serviço consulta `podeTransitar` e
`montarLancamento`; a rota não consulta nem uma nem outra — há teste varrendo a fonte da rota atrás
de `podeTransitar`, `montarLancamento` e `accountingEntry.`.

## Decisões que parecem detalhe e não são

- ⚠⚠ **`ORIGENS_VALIDAS` é mapa de INCLUSÃO.** Estado novo nasce **bloqueado**, não permitido.
  A matriz inteira (estado × transição) tem teste.
- ⚠⚠ **A conta de caixa é resolvida pelo `codigoCompleto` `111010001`, nunca pelo reduzido `"5"`.**
  *"eles são imutáveis enquanto os reduzidos mutáveis."* Cravar `"5"` funcionaria hoje e poria a
  despesa numa conta qualquer no dia em que alguém renumerasse o plano de uma empresa.
- ⚠⚠ **Conta ambígua ou fora do plano RECUSA.** Duas contas com o mesmo `codigoCompleto` ⇒ o
  sistema **não escolhe**: escolher poria a despesa num código que o contador não escolheu.
- ⚠⚠ **`eventType` NULO não é esquecimento.** O UNIQUE PARCIAL
  `("portalClientId","competencia","eventType","origem") WHERE tipo <> 'BAIXA'` está vivo. Com nulo,
  o Postgres trata cada linha como distinta e N notas do mês convivem. Preenchê-lo faria a
  **segunda** nota da competência estourar P2002 — em produção, não em teste.
- ⚠ **`origem: "CONFERENCIA"` é valor novo**, deliberado: `MANUAL` e `EXCEL` já respondem "quem
  digitou isto?". Procedência própria é o que permite achar (e desfazer) esses lançamentos depois.
- ⚠ **`RECUSADO` tem volta (`REABRIR`).** Recusar por engano deixaria a despesa daquela nota
  inalcançável para sempre, em silêncio — e esta casa já pagou por becos assim.
- ⚠ **`REABRIR` volta para onde a EVIDÊNCIA manda**, não para um estado fixo: com data de pagamento
  vai a `A_CONFERIR`; sem ela, a `AGUARDANDO_PAGAMENTO`.
- ⚠ **`DESFAZER` não apaga a declaração da data.** Desfazer o LANÇAMENTO não é desfazer a
  DECLARAÇÃO; ela fica à vista e editável.
- ⚠ **`competencia` NULA não vira lançamento**, e **não** é deduzida da data. Seria o sistema
  decidindo em qual apuração a despesa entra — a mesma recusa que a auditoria de notas já aplica.
- ⚠ **Mês fechado recusa nos DOIS sentidos** (409). Contabilizar escreveria sem rastro de
  reabertura; desfazer apagaria lançamento que o fechamento já conferiu.
- ⚠ **`agora` é INJETADO no serviço.** Ele é o carimbo de auditoria (`decididoEm`) e **nunca** pode
  virar a data do pagamento. Há teste varrendo a fonte atrás de `new Date()`.
- ⚠ **A data do corpo passa por `dataCivilDe`**, que é estrito: recusa formato americano, mês sem
  zero à esquerda e **dia que não existe** (`2026-02-31` volta `null`, não 3 de março).

## ⚠ `accountingEntryId` NÃO tem FK, de propósito

Mesmo desenho de `AccountingEntry.estornoDeEntryId`. Com `SET NULL`, um lançamento apagado por fora
deixaria a linha em `CONTABILIZADO` apontando para nada e o apagamento da evidência seria
**silencioso**. Com `RESTRICT`, o `DELETE /entries/:id` que o contador já usa passaria a devolver
500. **Sem FK o id fica**, e `varrerInvariantes` o denuncia nomeando o que houve.

Pelo mesmo motivo o desfazer usa **`deleteMany`, não `delete`**: `delete` estouraria P2025 e o
declarado ficaria preso em `CONTABILIZADO` para sempre.

## ⚠ A varredura das invariantes

`varrerInvariantes()` — **só leitura**. Existe porque as invariantes não são todas exprimíveis em
constraint. Ela responde quatro perguntas:

1. lançamento vinculado **fora** de `CONTABILIZADO`;
2. `CONTABILIZADO` **sem** lançamento;
3. **ponteiro pendurado** (o lançamento foi apagado por fora) — ⚠ só detectável porque não há FK;
4. ⚠⚠ `A_CONFERIR`/`CONTABILIZADO` **sem data de pagamento** — a invariante do caixa.

Rota: `GET /firm/companies/:id/conferencia/varredura`.

## ⚠⚠ O QUE A FILA DEVOLVE — e as quatro coisas que uma revisão da tela apontou como faltando

Um exame do lado do front (24/08/2026) achou quatro lacunas *"baratas agora, caras depois que a
tela existir"*. As quatro estão fechadas:

| | por quê |
|---|---|
| **`porEstado`** | é ele que diz **quanto trabalho existe e de que tipo**. ⚠ Sai de `groupBy`, **nunca** de `itens.length` — lista truncada como total mentiria exatamente na empresa em que o problema é grande. ⚠ E ele **ignora o filtro de estado** (senão contaria a própria página filtrada) mas **respeita a competência**, que é o recorte. Estado sem linha vem **zero**, não ausente |
| **`mesFechado`** por linha | pré-voo: a tela desabilita **com o motivo** em vez de oferecer um clique que o servidor recusa com 409. Precedente do menu SERPRO — *"a resposta do POST chegaria tarde demais"*. ⚠ **UMA query para a página inteira** (`competenciasFechadas`), não uma por linha. ⚠ E **não é a guarda**: quem recusa continua sendo `aplicarTransicao` |
| **`nota`** (número, série, chave, tipo) | o contador confere a fila contra o documento **pelo número**; sem ele teria de cruzar CNPJ + data + valor. ⚠ `null` quando a nota foi apagada (a FK é `SetNull`) — a tela desabilita o link **com o motivo**, nunca o esconde |
| **`competencia=sem-competencia`** | ⚠⚠ `where.competencia = "2026-07"` **não casa com `NULL`** em SQL: sem este recorte a nota que chegou sem competência ficaria **invisível para sempre**. É literalmente o defeito que a auditoria de notas já pagou (*"a consulta que fabricava buraco"*). ⚠ A saída **não** é atribuí-la a um mês |

⚠⚠ **`anexos` É SEMPRE `[]` — e a tela NÃO pode oferecer "anexar comprovante".** `AnexoDeclarado`
existe no schema e **não tem escritor**: nenhuma rota, nenhum serviço, nenhuma chamada. Desenhar o
botão prometeria um caminho que não existe. O campo viaja para o contrato não mudar no dia em que
ele existir.

### ⚠ `competenciasFechadas` mora colada a `isMonthClosed`, e há teste exigindo que concordem

São duas leituras da MESMA coluna (`CompanyMonthlyCircular.fechadoContabilEm`). Separá-las em
arquivos diferentes é como as quatro cópias do filtro de envio de guia divergiram nesta base — no
mesmo arquivo, quem mudar o critério de "fechada" vê as duas na mesma tela.
⚠ `isMonthClosed` **não** foi reescrita para delegar: ela tem dezenas de chamadores em caminhos
críticos (baixa, DELETE, guia, parcela), e trocar a query deles não é assunto da fila.

## ✅ FASE B1 — a nota recebida vira fila

`POST /firm/companies/:id/conferencia/varrer-notas?desde=AAAA-MM-DD`

⚠⚠ **A DATA-PISO É OBRIGATÓRIA** (400 sem ela). São 1.897 NFS-e recebidas: sem corte, a primeira
varredura produz a base inteira de uma vez — e isso não é fila, é muro. Um default faria o
**sistema** escolher o tamanho do trabalho que o contador encontraria na tela.

**Medido em ensaio contra produção** (`scripts/diag-notas-viram-despesa.mjs`, só leitura, piso
01/07/2026): **229** notas virariam declarado · R$ 765.011,26 · **114 fornecedores** ·
**0 sem competência** · **0 sem CNPJ** · 32 sem `xDescServ` (as NF-e, que são resumo).
Fora: 1.595 pelo piso, **62 sem valor**, **60 canceladas** — todas nomeadas no relatório.

- ⚠⚠ **`new Date(null)` é `1970-01-01`, uma data VÁLIDA.** Sem a guarda explícita, nota sem emissão
  viraria despesa datada de 1970 — ordenando a fila inteira e abrindo uma janela de meio século no
  casamento com o pagamento. Mesma família de `Number.isFinite(Number(null))`. Achado por teste.
- ⚠⚠ **`PortalInvoice.competencia` é `DateTime`; a do declarado é `String "AAAA-MM"`.** Um
  `String(nota.competencia)` gravaria `"Wed Jul 01 2026…"` — passa no Prisma (a coluna é texto) e
  só aparece como lançamento que nenhum filtro de competência encontra.
- ⚠⚠ **`montarIndiceDeCiclo` devolve um ARRAY de `{...nota, ciclo}`, apesar do nome.** Tratá-lo como
  `Map` (`.get(id)`) devolve `undefined` **sem erro** e o código cai num fallback que perde o
  contexto de substituição. Aconteceu aqui e no diagnóstico; achado por teste.
- ⚠ **A situação vem do ciclo, e o que ele acrescenta é real:** `statusEfetivo` só guarda
  `autorizada|cancelada` — **substituição não cabe nela**.
- ⚠ **O corte por data acontece TAMBÉM na query**, não só na regra: carregar 1.897 notas para
  descartar 1.595 é o que ele evita. A regra mantém o corte porque ela é a autoridade e é quem
  **nomeia** o motivo.
- ⚠ **Sequencial, sem parâmetro de concorrência** — parâmetro é como alguém põe 20 nele depois.
- ⚠ **Uma nota recusada não derruba o lote**: vira linha nomeada em `recusados`.
- ⚠⚠ **Idempotente por PULAR.** Nota já enfileirada volta em `jaExistiam` sem nada ser tocado — um
  `upsert` devolveria um `RECUSADO` à fila a cada varredura, e a captura de notas roda sozinha.

## ✅ FASE B2 — o extrato vira o PAGAMENTO da nota

`POST /client/companies/:id/ofx/import` (o cliente sobe) · `GET /firm/companies/:id/conferencia/casamentos`
e `POST .../conferencia/casamentos/fundir` (o contador confere).

### ⚠⚠ O parser de OFX foi EXTRAÍDO, não reescrito

Ele vivia dentro de `routes/firm/accountingEntries.js:270-414`, **sem export**. As 145 linhas foram
para `application/accounting/lib/ofx.js` **sem uma mudança**, e o import do escritório continua
chamando o mesmo código.

⚠ **O teste de caracterização foi escrito ANTES da extração e não foi editado depois**
(`routes/firm/__tests__/ofxImportCaracterizacao.test.js`, 21). É ele que prova que o refator foi
puro — inclusive as peculiaridades que ninguém escolheu e que agora são contrato: o memo chama-se
**`historico`**, o `valor` é **absoluto** com o `sinal` à parte, e a data vem do `DTPOSTED`.

⚠ **`parseOfx` ganhou `lerOfx` ao lado e passou a DELEGAR.** `lerOfx` acrescenta o que faltava — a
**conta bancária** (`BANKACCTFROM/ACCTID`) e os **descartes nomeados**. Sem a conta, duas contas da
mesma empresa com o mesmo valor no mesmo dia seriam a mesma transação.

### ⚠⚠ A IDENTIDADE DE UMA TRANSAÇÃO — `lib/dedupeOfx.js`

**Medido antes de desenhar:** não havia proteção nenhuma. `fitId` **nem existe** em
`AccountingEntry`, não há hash, e o lote é `OFX-${Date.now()}` — subir o mesmo arquivo 2× duplicava
tudo. (Em produção há **0** lançamentos de origem OFX, então não há dado a recuperar.)

⚠⚠ **A SOBREPOSIÇÃO DE PERÍODOS É O CASO NORMAL, não o abuso.** O cliente baixa 01–31/jan e depois
15/jan–15/fev. Proteger por "arquivo repetido" resolveria o caso fácil e falharia no comum: a
proteção é **transação a transação**, pelo `@@unique(portalClientId, hashDedupe)` — no BANCO, não
no código.

Duas chaves, nesta ordem:

| chave | quando | o que entra |
|---|---|---|
| `FITID` | o arquivo traz o campo | conta bancária + `FITID` |
| `IMPRESSAO` | sem `FITID` | conta + data + valor + memo normalizado + ⚠ **ordinal posicional no arquivo** |

⚠⚠ **O ORDINAL É O QUE PRESERVA DUAS TARIFAS IGUAIS NO MESMO DIA.** Sem ele, duas linhas idênticas
(mesma data, mesmo valor, mesmo memo — o caso real de tarifa bancária) colapsariam numa só e **uma
despesa real sumiria em silêncio**. Ele é a posição **dentro do arquivo**, e é estável porque o
banco exporta na mesma ordem.

⚠ **`normalizarParaDedupe` é CONGELADA** — maiúsculas e colapsar espaço, **nada mais**. Ela **não é**
`normalizeMatchText` (`excelImport.js`), e a diferença é o ponto: aquela remove datas e números de
documento, que aqui são justamente o que distingue duas linhas. Afrouxá-la faz despesa sumir; há
teste sobre isso.

### ⚠ O import do cliente — `ImportOfxService`

- ⚠⚠ **SÓ DÉBITO ENTRA.** Crédito não é despesa; ele volta contado em `foraDoEscopo`, nunca
  descartado em silêncio. (Nota recebida como ENTRADA está fora deste escopo, por decisão do dono.)
- **O débito nasce `A_CONFERIR` com `origemPagamento: OFX`** — ele tem data, e a data é PROVA.
- ⚠ **A competência é DERIVADA da data da transação**, e o precedente é o import do escritório, que
  já faz assim. Não é invenção: o extrato **tem** a data; é a nota que não tem a do pagamento.
- ⚠ **O relatório volta INTEIRO** — criadas, já importadas, fora do escopo, descartadas e as
  anomalias. Um "criei 23" sozinho deixaria "não veio nada" indistinguível de "deu erro".

### ⚠⚠ O CASAMENTO — `lib/casamentoPagamento.js`

Quatro princípios, cada um travado em teste:

1. ⚠⚠ **NUNCA AUTOMATIZA.** Não é conservadorismo, é medição: as NF-e recebidas **não têm
   duplicata** (`<cobr><dup>` não é lido, não há coluna, e as 49 são resumos sem XML), então **não
   existe vencimento** para ancorar a janela. Evidência boa para sugerir, fraca para decidir.
2. ⚠⚠ **AMBIGUIDADE NÃO SE RESOLVE ESCOLHENDO.** Dois candidatos ⇒ **nenhum** é eleito e os dois
   aparecem. Mesma disciplina do `AMBIGUO` do vínculo de telefone e do "nunca o primeiro da lista"
   do código de serviço.
3. ⚠⚠ **A PISTA DO FORNECEDOR É OBRIGATÓRIA.** Valor + data não bastam — duas mensalidades do mesmo
   valor no mesmo mês são comuns, e casar por elas põe a despesa no fornecedor errado.
   *Experimento: tirando a exigência da pista, **6 vermelhos**.*
4. ⚠⚠ **UMA NOTA NÃO PODE SER SUGERIDA A DOIS DÉBITOS.** Ela foi paga uma vez; oferecê-la duas vezes
   convidaria a fundir as duas, e o segundo débito voltaria a parecer despesa sem nota depois do
   fato. Nota disputada vira **ambígua para os dois**.

⚠ **Os números são HEURÍSTICA, não norma** — nenhuma regra fiscal os define; eles saem do que um
extrato brasileiro parece. `TOLERANCIA_VALOR = 0,05` (⚠ **centavos, nunca percentual**: 2% casaria
uma nota de R$ 10.000 com um débito de R$ 9.800, que é outra coisa) · janela de **−5 a +90 dias** da
emissão · `MINIMO_DE_LETRAS = 4` · `PALAVRAS_SEM_IDENTIDADE` (sem ela, "SERVICOS" no memo casaria
com toda nota de toda empresa de serviço).

### ⚠⚠ FUNDIR NÃO É CONTABILIZAR

A nota recebe a data (`INFORMAR_PAGAMENTO`, com `fitId`/`ofxImportId`/`contaBancariaRef` viajando
junto como prova) e o débito vira **`FUNDIDO`** apontando para ela. As duas escritas numa
`$transaction`. **Nenhum `AccountingEntry` é criado** — quem leva ao razão continua sendo o
contador, num segundo ato.

- ⚠⚠ **A REGRA É RECONFERIDA NO SERVIDOR.** A sugestão que a tela mostra pode ter envelhecido: o
  valor foi ajustado, a nota recusada, outro débito fundido nela. Quem decide no instante do clique
  é o servidor (`CASAMENTO_NAO_CONFERE`).
- ⚠ **As sugestões são DERIVADAS NA LEITURA, nunca coluna** — precedente de `divergenciaDeFonte.js`.
  Coluna de sugestão envelheceria calada.
- ⚠ **A rota de fundir NÃO tem guarda de mês fechado**, e é deliberado: nada chega ao razão. Quem
  recusa mês fechado continua sendo `CONFIRMAR`.

## ⚠⚠ A FASE C0 (BACKFILL) FOI CANCELADA — a memória por descrição JÁ EXISTE

**Decisão do dono, 24/08/2026**, depois da medição. ⚠ **Não a reconstrua.**

O plano previa aprender "descrição → conta" numa tabela nova (`RegraContabilizacao`), alimentada por
um backfill sobre os 155 DESPESA. Ao escrever esse backfill apareceu **`AccountingHistorico`** —
que já responde exatamente essa pergunta, já está povoada, e é alimentada pelo contador **toda vez
que ele lança** (`upsertHistoricoFromImport`).

**Medido em produção** (`scripts/diag-memoria-historico.mjs`, só leitura):

| | |
|---|---|
| `AccountingHistorico` | **227** registros · 209 com `contaDebito` · **17 empresas** · ⚠ **1 usuário** |
| o backfill produziria | **91** chaves empresa × descrição · **91 unânimes, 0 divididas** |
| ⚠ o plano dizia **77** | eram **91**. E com **piso 2+ são só 34** |
| ⚠⚠ **a memória já conhece** | **67 das 91 (73,6%)** — concorda em 66, **discorda em 1** |
| o backfill acrescentaria | **24** |

⚠⚠ **O prêmio nunca foram "milhares", nem 77: são 24** — e construir a segunda memória criaria duas
fontes discordando sobre a mesma descrição da mesma empresa. Já há **um conflito medido**
(`FAST SHOP S A`: o lançado diz `170`, a memória diz `169`). É o defeito que esta base já pagou com
o parser de OFX, com a ingestão de NFS-e e com as quatro cópias do filtro de envio de guia.

**O desenho que ficou:**

| âncora | fonte | por quê |
|---|---|---|
| **descrição** (fraca) | ⚠ **LER `AccountingHistorico`** | já existe, já povoada, e se mantém sozinha |
| **CNPJ do fornecedor** (forte) | `RegraContabilizacao` | ⚠ a memória **não tem CNPJ**, e só o caminho da nota o preenche |

⚠ **As 24 que faltam não precisam de backfill**: elas entram sozinhas na próxima vez que o contador
lançar aquela descrição.

⚠ **LIMITAÇÃO NOMEADA, não resolvida:** a chave de `AccountingHistorico` inclui **`createdByUserId`**.
Hoje há **1 usuário**, então funciona; com dois contadores, a memória de um não serve ao outro.
Levar ao dono quando o segundo aparecer — **não "consertar" ampliando a chave por conta própria**,
que mudaria o comportamento da tela de lançamento, que é outro dono.

## ✅ A TELA DO CONTADOR — aba **Conferência**, grupo Contabilidade (24/08/2026)

`apps/web/src/features/conferencia/` · rota `/companies/:id/conferencia`.

⚠ **Ela fica em CONTABILIDADE, logo depois de Lançamentos — não em Fiscal.** O que sai dela é
`AccountingEntry`, e o contador chega nela vindo de Lançamentos. Em Fiscal pareceria conferência de
nota, que é a Auditoria.

⚠ **A REGRA NÃO FOI REESCRITA NO FRONT.** Quem decide se uma transição pode acontecer continua sendo
`aplicarTransicao`, no servidor. O que mora na tela é a LEITURA (`lib/conferenciaTela.js`, **57
testes**): rótulo, cor, ordem, e qual botão sequer aparece.

**O que a tela faz, e por quê:**

| | |
|---|---|
| ⚠⚠ **a procedência da data à vista** | `Extrato bancário` (prova) × **`Declarado`** (não prova, em âmbar). Sem isso, a data que o banco confirmou e a que o contador digitou ficam **idênticas** — e a decisão de lançar sem comprovante vira afirmação falsa sobre quando a empresa pagou |
| **agrupada por fornecedor** | é o que torna 229 linhas conferíveis. Ordem por **volume**, não alfabética |
| ⚠⚠ **os selos de contagem são FILTRO** | achado ao verificar no navegador: o painel dizia *"Contabilizado: 1"* e **não havia caminho nenhum** para ver esse item. Número na tela sem porta para ele faz o contador concluir que o sistema perdeu a despesa |
| ⚠⚠ **botão "Sem competência"** | `where.competencia = "2026-07"` **não casa com NULL** em SQL. Sem esta porta a nota que chegou sem competência fica invisível para sempre — o defeito que a auditoria de notas já pagou |
| **o modal pergunta ANTES** | confirmar sem data pede a data; recusar exige motivo. A tela não descobre a regra pelo erro do servidor |
| ⚠ **a confirmação REPETE os dados** | fornecedor, CNPJ, valor e competência. *"Tem certeza?"* não é confirmação — aprende-se a clicar sem ler |

⚠⚠ **A DATA NASCE COM A EMISSÃO DA NOTA, NUNCA COM "HOJE"** — verificado no navegador em
25/08/2026: o campo abriu em `2026-07-02` (a emissão) e não em `2026-08-25`. "Hoje" é a data do
CLIQUE, e afirmaria que a empresa pagou no instante em que alguém abriu a tela.

⚠ **Botão bloqueado fica VISÍVEL e desabilitado, COM o motivo no `title`** — mês fechado, competência
ausente, papel insuficiente. Botão que some esconde que a ação existe; botão mudo não diz qual é o
conserto. Verificado na tela: *"A competência está fechada. Reabra o mês para mexer no lançamento."*

⚠⚠ **A TELA NÃO OFERECE "ANEXAR COMPROVANTE"** — `AnexoDeclarado` existe no schema e **não tem
escritor**. Desenhar o botão prometeria um caminho que não existe. Há teste varrendo a tela.

⚠ **Nenhum estado usa `--state-danger`**, e `AGUARDANDO_PAGAMENTO` é **neutro, não âmbar**: nota sem
pagamento identificado não é pendência nossa, é a resposta certa. Âmbar permanente treina o olho a
ignorar a cor que significa "falta fazer".

⚠ **As TRÊS PEÇAS da aba nova** (`features/companies/CLAUDE.md`) foram todas feitas: entrada em
`GROUPS`, o par em `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT` e o bloco `if` na página. Faltando o par, a URL
cai em Anotações **sem erro nenhum** — conferido navegando direto para `/conferencia`.

⚠ **O mock exercita TODOS os desenhos** (`api/mock/mockApi.js`): as duas procedências, mês fechado,
nota apagada, débito sem documento, e a nota sem competência. Este projeto foi mordido **quatro
vezes** por ramo que só existia em produção.

### ✅ O PAINEL DE CASAMENTOS e a VARREDURA — na tela (25/08/2026)

`features/conferencia/components/PainelDeCasamentos.jsx` · `ModalDaVarredura.jsx`.

**O painel fica ACIMA da fila**, e some sozinho quando não há débito esperando — um bloco permanente
dizendo "nada a casar" seria ruído na maioria das empresas, que nunca importaram extrato.

⚠⚠ **AMBIGUIDADE NÃO GANHA BOTÃO, e isso é o coração da tela.** Verificado no navegador: **3 débitos,
1 botão de casar**. Com dois candidatos os DOIS aparecem e **nenhum** tem porta — um "casar" ao lado
de cada um pareceria inofensivo e converteria a recusa do sistema em decisão do dedo de quem está com
pressa. A saída é o contador identificar a nota certa e informar o pagamento NELA, na fila abaixo.

⚠⚠ **A confirmação diz que CASAR NÃO CONTABILIZA.** Sem essa frase o contador acha que o lançamento
saiu e não confere a fila depois. Ela repete os dois lados — débito e nota —, porque *"tem certeza?"*
não é confirmação.

⚠ **A PISTA aparece na linha** (*"o nome do fornecedor aparece na descrição do banco"*). *"Por que o
sistema acha que é esta?"* é a pergunta que o contador faz, e respondê-la é o que torna a sugestão
conferível em vez de mágica.

⚠ **`ambiguo` é ÂMBAR, não vermelho** — é o sistema funcionando, não quebrando. **`nenhum_candidato`
é NEUTRO**: débito sem nota é comum e legítimo, e âmbar ali encheria a tela de pendência falsa.

⚠⚠ **A VARREDURA NASCE COM O CAMPO DE DATA VAZIO** — verificado na tela: campo em `""` e botão
desabilitado com *"Escolha a data a partir da qual as notas devem entrar."* Sugerir "o primeiro dia
do mês" pareceria prestativo e seria a TELA decidindo o volume de trabalho, que é a decisão do
contador. O servidor recusa sem `desde` (400 `data_piso_obrigatoria`); o diálogo existe para ele não
descobrir a regra pelo erro.

⚠ **O relatório sai INTEIRO** — medido na tela: *"12 entraram · 18 olhadas · 4 já estavam na fila · 1
fora do período"*, mais as recusadas **com o motivo em português**. ⚠ E `0 novas · N já existiam` tem
frase própria: é a **idempotência funcionando**, não falha — sem dizê-lo, o contador roda três vezes
achando que não funcionou. ⚠ *"Nada varrido"* é resposta diferente de *"nada criado"*, e propõe o
conserto certo (uma data anterior).

⚠ **Motivo de recusa desconhecido aparece CRU**, nunca sumindo nem virando "erro desconhecido": o
contador vê o código e pode perguntar.

### ⚠⚠ O MOCK JÁ DIVERGIU DO SERVIDOR — e agora há rede

**Defeito real (25/08/2026):** o mock devolvia `casamentos` e a rota devolve **`linhas`**. Isso falha
da pior maneira possível — a tela funciona **offline** e quebra **em produção**, ou seja, o erro só
aparece depois do deploy. A regra do `apps/web/CLAUDE.md` já dizia *"manter contratos idênticos entre
mock e real"*; faltava alguém verificar.

**`features/conferencia/lib/__tests__/contratoDaConferencia.test.js` (14)** confere cada chave DUAS
vezes: que o mock a produz, e que ela aparece na **fonte** da rota (ou do serviço que ela espalha).
Renomear no backend derruba a segunda; esquecer no mock derruba a primeira.
*Experimento executado: devolvendo `casamentos` ao mock, **5 vermelhos**.*

⚠ A amarração é **textual** — o backend não é importável do front (cruzar apps quebra o boot). Mesma
disciplina do teste que amarra `"autorizada"` à `whereFaturamentoEmit`.

## ✅ FASE C — a sugestão de conta e o aprendizado (25/08/2026)

`lib/motorDeSugestao.js` (33 testes) · `lib/aprendizado.js` (24) · `RegraService.js` (24) ·
`__tests__/aprendizadoNaTransicao.test.js` (10).

⚠⚠ **NADA DISTO CONTABILIZA.** A regra **sugere** a conta; quem leva ao razão continua sendo o
contador, confirmando na fila.

⚠⚠ **ESTE PARÁGRAFO DIZIA QUE O "NÍVEL 1" (regra ativa lança sem clique) NÃO FOI CONSTRUÍDO — e isso
mudou em 29/08/2026.** O dono decidiu ligar, e ele existe em `LancamentoPorRegraService.js`.
⚠ O que continua verdade, e é o que mais importa: **nada lança hoje** — a flag nasce OFF,
`lancaSozinha` nasce `false`, e a função **não tem chamador**. Ver a seção da Fase 6.

### ⚠⚠ AS DUAS ÂNCORAS NÃO ENTREGAM O MESMO — medido antes de escrever

`scripts/diag-fase-c.mjs` (só leitura), produção, 25/08/2026:

| âncora | alcance MEDIDO | por quê |
|---|---|---|
| **CNPJ do fornecedor** | **140 de 211** pares empresa×fornecedor têm 2+ notas (66,4%) | a nota TRAZ o CNPJ |
| **descrição** | ⚠ **15 de 1.887** notas (0,8%) | a memória foi construída sobre memos de EXTRATO e planilha, **não** sobre nomes de prestadores |

⚠ **A âncora por descrição não é inútil — ela está no lugar errado das NOTAS.** Ela é o caminho
natural dos débitos de **OFX**, cujo memo bancário é exatamente o tipo de texto que
`AccountingHistorico` guarda. Por isso as duas existem, e por isso **o CNPJ vence** quando as duas
casam: o CNPJ **identifica**, a descrição apenas **se parece**.

### ⚠⚠ A MEMÓRIA GUARDA O REDUZIDO — a tradução acontece no motor

**Medido: 209 de 209** registros de `AccountingHistorico.contaDebito` casam com um **reduzido** do
plano; **zero** com um `codigoCompleto`. Como `RegraContabilizacao.contaDestino` exige o completo, o
motor **traduz pelo plano DAQUELA empresa** antes de sugerir.

- ⚠ O reduzido é **mutável**; o completo é a âncora desta casa. Devolver o reduzido cru faria a
  sugestão apontar para outra conta no dia em que alguém renumerasse o plano.
- ⚠ A tradução usa a precedência de sempre: **global é padrão, a da empresa sobrescreve**.
- ⚠⚠ **OS 40 REGISTROS GLOBAIS DA MEMÓRIA FICAM DE FORA** (`companyPortalClientId: null`). Um
  reduzido só significa algo dentro de UM plano. (Medido: hoje nenhum reduzido é ambíguo entre
  empresas — **0 de 606** —, mas isso é um fato de hoje, não uma garantia estrutural.)
- ⚠ Conta que não existe no plano da empresa vira recusa **nomeada** (`CONTA_FORA_DO_PLANO`), não
  silêncio: o contador precisa saber que **havia** memória.

### ⚠⚠ O QUE O MOTOR SE RECUSA A FAZER

| situação | resposta |
|---|---|
| duas regras vivas discordando | **`DIVIDIDO`** — nenhuma vale. Escolher "a mais recente" poria a despesa numa conta que ninguém escolheu, **em série** |
| histórico dividido | **`DIVIDIDO`** — a mesma descrição em duas contas quer dizer que o contador mudou de ideia |
| âncora casou, valor fora da faixa | **`FORA_DA_FAIXA`**, com o `regraId`. ⚠ Isso é **SINAL, não silêncio**: é o caso que a faixa existe para pegar (fornecedor conhecido, valor 10× fora) |
| regra suspensa ou inativa | ignorada. **Freio que ainda dirige não é freio** |

### ⚠⚠ O APRENDIZADO — e as duas coisas que o impedem de se enganar sozinho

**Unanimidade E piso 2.** Duas confirmações em contas diferentes não são um hábito, são uma dúvida —
e dúvida não vira automação. A faixa nasce **±15%** sobre o menor e o maior confirmados, e é
**obrigatória**: sem valor legível, **nada nasce**.

⚠⚠ **CONFIRMAÇÃO NASCIDA DE REGRA NÃO REALIMENTA O APRENDIZADO** (`regraId` preenchido é ignorado).
Sem isso a regra **se auto-confirma**: ela lança, a própria linha vira "confirmação", e uma conta
errada se prova certa sozinha, em série.

⚠⚠ **REGRA MANUAL NUNCA SE SUSPENDE SOZINHA.** Ela foi decisão explícita de uma pessoa; desligá-la
por observação seria o sistema revogando essa decisão. A **APRENDIDA** se suspende na hora em que
uma confirmação aparece em outra conta (`divergencia`) ou a base some (`base_desfeita`) — motivos
**distintos**, porque o conserto de cada um é outro.

⚠ **Desligar à mão grava `ativa: false`, nunca `suspensaEm`.** As duas colunas respondem coisas
diferentes: `suspensaEm` é *"o sistema se freou"*; `ativa` é *"o contador decidiu"*. ⚠ E **religar à
mão LIMPA a suspensão** — sem isso a regra ficaria ativa com `suspensaEm` preenchido, o motor
continuaria a ignorá-la, e o botão pareceria não fazer nada.

### ⚠⚠ O APRENDIZADO RODA DEPOIS DA TRANSAÇÃO, E FORA DELA

Ele é **consequência** do que o contador decidiu, não parte da decisão. Dentro da `$transaction`,
uma falha ao criar a regra **desfaria o lançamento** que ele acabou de confirmar. Por isso
`reavaliarAprendizado` **não lança** — devolve o que fez. Sem a migration, a tabela não existe
(P2021) e a confirmação continua valendo.

⚠ Dispara em **CONFIRMAR, AJUSTAR e DESFAZER**. ⚠ **`RECUSAR` não** — recusar não diz nada sobre em
que conta o fornecedor deve ser lançado. ⚠ **`INFORMAR_PAGAMENTO` não** — ele muda a data, não a
conta.

⚠⚠ **ACHADO AO ESCREVER O TESTE:** `aplicarTransicao` tem um **caminho simples** que faz
`client.lancamentoDeclarado.update` direto e **retorna antes da transação**, para as transições que
não tocam o razão. Então `RECUSAR`/`INFORMAR_PAGAMENTO` são excluídos por **duas** razões
independentes — a lista `APRENDE_COM` e o retorno antecipado. A segunda é a que morde hoje; a
primeira protege se o caminho simples mudar.

### A sugestão chega na fila

`listarFila` devolve `sugestao` por linha — **derivada na leitura, nunca coluna**. `contaSugerida`
existe no model e é gravada quando o declarado NASCE, mas uma regra criada depois **não a
atualizaria**, e o contador veria a fila velha sem saber por quê (precedente de
`divergenciaDeFonte.js`).

⚠ **UMA busca de regras/memória/plano para a página inteira** — 229 linhas fariam 687 consultas.
⚠ **A fila nunca cai por causa da sugestão**: sem a migration, ela sai `null` e a tela diz "sem
sugestão", que é a resposta honesta.

**Rotas:** `GET /conferencia/regras` (⚠ P2021 devolve `{regras: [], indisponivel: true}`, não 500) ·
`PATCH /conferencia/regras/:regraId` (`minRole: ACCOUNTANT`).

### ⚠⚠ O QUE A FASE C **NÃO** FAZ — e é decisão, não lacuna

**A regra não lança sozinha.** O plano previa o "nível 1" contabilizando direto, sem clique. A
estrutura para isso já existe (faixa obrigatória, `regraId` no declarado, procedência gravada,
desfazer transacional) — falta a **decisão do dono** de ligar, e o extrato mensal "lançados por
regra" para ele desfazer em lote.

⚠ Um lançamento contábil nascido sozinho, numa conta errada, erra **em série e em silêncio**. Isso
não se liga sem quem responde pela contabilidade dizer que sim.

**Experimentos executados** (o que cai ao desligar cada guarda):

| desligando | vermelhos |
|---|---|
| a regra REALIMENTANDO o próprio aprendizado | **2** |
| maioria em vez de unanimidade | **2** |
| `MANUAL` passando a se suspender sozinha | **1** |
| o histórico devolvendo o **reduzido cru** | **4** |
| fora da faixa passando a sugerir mesmo assim | **3** |

## ✅ FASE E — o extrato em EXCEL (28/08/2026)

> Decisão do dono (27/08/2026): *"extrato pode e deve ser enviado em OFX ou EXCEL, no caso do excel
> o contador precisa normalizar para ser consumido"* — e, sobre COMO: *"o contador mapeia as
> colunas, e o mapeamento fica salvo por empresa"*.

`POST /client/companies/:id/extrato-excel/import` (o cliente sobe) ·
`GET`/`PUT /firm/companies/:id/conferencia/mapeamentos-extrato[/:assinatura]` (o contador confirma).

### ⚠⚠ NADA ENTRA SEM UM MAPEAMENTO CONFIRMADO

É a trava da fase. O sistema **propõe** (a partir de `excelImport.HEADER_ALIASES`, os mesmos
apelidos que o import do escritório já usa) e uma **pessoa confirma**, uma vez por formato. Sem a
linha confirmada, o envio devolve a proposta e **cria zero declarados**.

⚠ Por isso o retorno tem DOIS desfechos de sucesso, e eles não se parecem: `precisaDeMapeamento`
(nada entrou, e o que falta é um clique do contador) × o relatório. Um "0 novas" para os dois casos
seria indistinguível de "este período já estava todo importado".

⚠ **Um mapeamento que JÁ EXISTE não é sobrescrito pela proposta** — ele pode ter sido confirmado e
depois invalidado por mudança de formato, e apagar a decisão de uma pessoa por causa de um arquivo
é o que essa guarda impede.

⚠ **A confirmação valida o que VAI FICAR GRAVADO**, não o corpo: campo ausente herda do registro
antigo, e validar só o corpo deixaria confirmar um mapeamento cujo campo herdado está incompleto.
⚠ Salvar sem confirmar é permitido (o contador ajusta em duas sessões) e **nunca liga** o
`confirmado`: mexer no mapeamento não é reafirmá-lo.

### ⚠⚠ A CHAVE NÃO É "O BANCO" — é a ASSINATURA DO CABEÇALHO

O mapeamento é "por empresa + banco", e a pergunta que o formato não responde é **qual banco é
este?** Planilha de extrato não tem `<BANKID>` como o OFX; tem um nome de arquivo que a pessoa
renomeia e um cabeçalho. `assinaturaDoCabecalho` = as células normalizadas e **ORDENADAS**.

⚠ Ordenadas de propósito: o banco reordena colunas entre versões, e chave sensível à ordem faria o
contador remapear a MESMA planilha. Os ÍNDICES continuam sendo lidos do arquivo de cada envio.
⚠⚠ **Ela não é o nome do banco** — é impressão digital. O rótulo legível é o contador que escreve,
em `rotulo`; deduzir "Itaú" de um cabeçalho seria inventar.

### ⚠⚠ TRÊS COISAS QUE NÃO SÃO REESCRITAS AQUI

- **A gramática do dinheiro** é `lerValorDaPlanilha` (`nfse/lote/celulasLote.js`), via
  `lerValorDoExtrato`. O que este acrescenta é o SINAL — aquela função **recusa valor não positivo**,
  o que é certo numa nota fiscal e errado num extrato. Não existe um segundo parser de moeda aqui.
  ⚠ Só o `-` À FRENTE é negativo: parêntese contábil e o `-` no FIM não foram medidos em extrato de
  banco neste projeto, e aceitá-los por analogia seria inventar leitura de dinheiro. Caem em
  ilegível, **contados e nomeados**.
- **A identidade da transação** é `lib/dedupeOfx.js`, a MESMA do OFX, **sem prefixo próprio**.
- **A gravação** é `criarDeclarado`.

⚠⚠ **`lerSinalDaLinha` NÃO usa `Number(valorBruto)`, e a diferença é a maioria das planilhas.**
`Number("1.234,56")` é **NaN**: todo extrato cuja coluna de valor chegou como TEXTO responderia "não
sei" em TODA linha, e o arquivo inteiro sumiria da fila em silêncio. É a família do
`Number(null) === 0`, com o sinal trocado. *Experimento: voltando ao `Number()`, **8 vermelhos**.*

### ⚠⚠ O DEDUPE ATRAVESSA OS DOIS FORMATOS — quando a conta é conhecida

O cliente que mandar o mesmo período em OFX e em Excel não pode ver a despesa duas vezes. Por isso a
impressão digital é a mesma (`OFXFP:conta:dia:valor:sinal:memo#ordinal`), sem namespace próprio.

⚠ Ela só casa quando os DOIS lados sabem a conta bancária — o OFX a traz em `<BANKACCTFROM>`, e a
planilha **não tem onde trazê-la**. Por isso a conta é campo do **ENVIO**, não do mapeamento (uma
empresa pode ter duas contas no mesmo banco, com o mesmo formato). Sem ela, o relatório devolve
`dedupeAtravessaFormatos: false` e a anomalia `SEM_CONTA_BANCARIA` — dito, em vez de descoberto como
despesa repetida.

⚠ **O ordinal continua sendo o que preserva duas tarifas iguais no mesmo dia** — planilha de banco
nunca traz `FITID`, então este caminho cai SEMPRE na impressão digital.

### ⚠ ORIGEM PRÓPRIA, e a PROCEDÊNCIA DO PAGAMENTO também

| | valor | por quê |
|---|---|---|
| `ORIGEM` | **`EXTRATO_EXCEL_CLIENTE`** | origem responde *de onde veio*; colapsá-la em `OFX_CLIENTE` faria o contador ler "OFX" numa linha que saiu de uma planilha cujas colunas ELE mapeou |
| `ORIGEM_PAGAMENTO` | **`EXTRATO_EXCEL`**, e ela **PROVA** | o que a data afirma é *"o dinheiro saiu neste dia"*, e quem afirma isso é o banco nos dois formatos. O mapeamento não muda se o dinheiro saiu; muda QUAL coluna é a data — e um mapeamento errado é conferido pelo contador na fila, antes de qualquer coisa chegar ao razão |

⚠⚠ **SEPARADA do `OFX` de propósito:** o OFX é arquivo estruturado que ninguém edita; a planilha
passa por um mapeamento que uma pessoa definiu e por um programa em que qualquer célula se altera.
As duas provam, e **não com a mesma força** — colapsá-las apagaria a diferença na tela em que ela
importa. ⚠ Sem isso, o débito de Excel não poderia ser FUNDIDO numa nota (`INFORMAR_PAGAMENTO`
recusa `PAGAMENTO_NAO_E_PROVA`), e o casamento inteiro ficaria morto para este formato.
⚠ **É a decisão desta entrega que mais merece a palavra do dono** — está nomeada, não escondida.

⚠ **`criarDeclarado` deixou de ter a lista de origens escrita à mão** (`["NOTA_RECEBIDA",
"CLIENTE_MANUAL", "OFX_CLIENTE"]`) e lê `Object.values(ORIGEM)`. Três literais ao lado de um
vocabulário congelado é como origem nova passa a ser aceita pela regra e recusada pelo serviço.

### ⚠⚠ NADA SOME — e "não deu para ler" é compartimento PRÓPRIO

`foraDoEscopo` (créditos: fato sobre o extrato) × `naoLegiveisTotal` (defeito do mapeamento ou do
arquivo). Somados num número só, um mapeamento errado passaria por "um extrato só de créditos".

⚠ **A AMOSTRA e a CONTAGEM são campos diferentes** — o defeito que o OFX pagou: a contagem real ia
para a coluna e não voltava, e quem escrevesse `naoLegiveis.length` na tela diria "50".
⚠ **E a amostra é só das ilegíveis**, nunca das entradas — achado por teste: elas iam juntas, e
`naoLegiveisTotal` já as excluía, então amostra e contagem falavam de populações diferentes.
*Experimento: misturando-as de novo, **1 vermelho**.*

### O registro do envio — `ofx_imports` guarda OS DOIS FORMATOS

⚠⚠ **Sim, o nome da tabela passa a mentir um pouco, e a alternativa é pior.**
`lancamentos_declarados.ofxImportId` é o ÚNICO ponteiro para "qual envio criou esta linha"; uma
tabela nova exigiria uma segunda coluna de ponteiro e faria `varrerInvariantes` conhecer as duas.
Renomear coluna que já tem escritor é migration destrutiva. O nome fica; o **formato vira dado**
(`formato: OFX | EXCEL`), com `mapeamentoExtratoId` ao lado.

### Migration

`20260828120000_add_mapeamento_extrato` — **ADITIVA e INERTE**, ⚠ **NÃO APLICADA**. Uma tabela nova
(`mapeamentos_extrato`) + duas colunas aditivas em `ofx_imports`.
⚠ **`ofx_imports` JÁ EXISTE em produção** (medido em 28/08/2026), então o `ALTER TABLE` roda contra uma
tabela real — e por isso ele é aditivo com `DEFAULT 'OFX'`: toda linha existente passa a declarar o
que de fato é, sem backfill. (Medido também: ela está **vazia**, então o default toca zero linhas hoje.) Subir o código antes não quebra nada: o import recusa
**nomeando** (`mapeamento_indisponivel`), e a listagem devolve `indisponivel: true`, nunca 500.

⚠ **Sem CHECK sobre `sinal` nem sobre as chaves de `colunas`**, pela mesma razão de
`codigosServicoNacional`: o Postgres não valida JSONB sem função, e migration que falha é P3009 com
o servidor fora do ar. A forma é guardada por `validarMapeamento`, que roda ANTES de qualquer linha
virar lançamento.

**Experimentos executados:**

| desligando | vermelhos |
|---|---|
| a exigência de `confirmado` | **2** |
| o sinal voltando a `Number(valorBruto)` | **8** |
| a amostra misturando as ENTRADAS | **1** |

### ⚠ O que a Fase E **não** entregou

- **as telas** — nem o envio no portal do cliente, nem o painel de mapeamento do contador. As rotas
  existem e ninguém as chama ainda;
- **a conta bancária no mock** — o portal do cliente não tem o campo, então `dedupeAtravessaFormatos`
  nasce `false` em todo envio até a tela existir;
- ⚠ **crédito continua fora do escopo**, como no OFX: esta fila é de DESPESA, e a forma do lançamento
  de ENTRADA não foi medida. Contado e nomeado, nunca sumido.

## ⚠⚠ FASE 6 — A REGRA QUE LANÇA SOZINHA (29–30/08/2026). **LIGADA, e as travas continuam.**

> Dono: *"a Lente tem todo mês um pagamento a Alessandro Nigro, CNPJ, que vai se tornar uma
> recorrência no fluxo deles. O contador deve poder colocar o código de débito e crédito nessa
> despesa, e todo mês que essa nota aparecer ela já é lançada em despesa."*
> Perguntado com que data: ***"lança numa data fixa que eu configuro"***.

⚠⚠ **ISTO REVERTE A DECISÃO ESCRITA NO FIM DE `lib/motorDeSugestao.js`**, e a reversão é do dono. O
que aquele arquivo dizia: *"o plano previa um 'nível 1' em que a regra ativa lança direto, sem
clique. Isso NÃO está construído, e a razão é o peso do ato: um lançamento contábil nascido sozinho,
numa conta errada, erra EM SÉRIE e em silêncio — e o dono é contador. (…) O que falta é a DECISÃO DO
DONO de ligar, e o extrato mensal 'lançados por regra' para ele poder desfazer em lote."*

⚠⚠ **ESTA SEÇÃO DIZIA "NADA LANÇA HOJE" ATÉ 30/08/2026, e as três linhas da tabela eram sobre o
que estava DESLIGADO.** O dono mandou concluir e ligar (*"pode terminar o que falta da fase 6, e
ligue tudo e faça as migrations"*). O que mudou, e o que **não** mudou:

| | antes | hoje |
|---|---|---|
| `INTEGRACAO_LANCAMENTO_POR_REGRA` | OFF | **ON no `.env` LOCAL**. ⚠ Em produção continua sendo ato do dono — variável do Railway, e o `config.js` não sabe o que está no ar |
| `RegraContabilizacao.lancaSozinha` | `false`, e **sem escritor** | `false` por default, e agora **tem duas portas**: o `POST` da regra e o `PATCH .../automatico` |
| `lancarPorRegra` | ⚠⚠ SEM CHAMADOR | **chamado por `lancarPorRegraNaEmpresa`, na varredura de notas** |
| as duas migrations | escritas, não aplicadas | **aplicadas no banco LOCAL** (30/08/2026). Produção é ato do dono |

⚠⚠ **O QUE NÃO MUDOU, e é o que segura tudo: continuam sendo DUAS CHAVES, e as duas precisam estar
ligadas.** Uma nota só vira lançamento sem clique quando a flag do ambiente está ON **e** a regra
daquele fornecedor está marcada `lancaSozinha` **e** a nota cai dentro da faixa. Fornecedor a
fornecedor, nunca a carteira inteira.

### O que existe

| arquivo | o quê |
|---|---|
| `LancamentoPorRegraService.js` | `podeLancarSozinho` (PURA), `lancarPorRegra`, `extratoDeLancadosPorRegra`, `desfazerLancadosPorRegra`. 28 testes |
| `RegraService.criarRegraManual` | a porta que faltava — a tabela só nascia `APRENDIDA` |
| `lib/estadosDeclarado.js` | `ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA` e a transição `CORRIGIR_DATA_PRESUMIDA` |
| migrations | `20260829180000` (`contaCredito`) e `20260829190000` (`lancaSozinha`, `diaDoLancamento`) — **aplicadas no LOCAL em 30/08/2026**; ⚠ produção é ato do dono |
| `LancamentoPorRegraService.lancarPorRegraNaEmpresa` | o LAÇO, chamado pela varredura. ⚠ Com a flag OFF ele **não consulta o banco** |
| `RegraService.definirLancamentoAutomatico` | liga/desliga o automático numa regra que JÁ existe — sem reescrevê-la (as `aplicacoes` são a evidência de que ela acerta) |
| `web: features/conferencia/components/PainelDeRegras.jsx` | a tela da regra manual, com débito, crédito (só disponibilidade), faixa e dia |
| `web: .../PainelDeLancadosPorRegra.jsx` | o extrato do que entrou sem clique, com desfazer em lote |
| `web: features/conferencia/lib/regraDoFornecedor.js` | o ESPELHO da regra, para o botão desabilitar COM o motivo |

### ⚠⚠ AS TRÊS TRAVAS DO LANÇAMENTO, cada uma medida por NÃO-CHAMADA

1. **a FLAG** — quem recusa é o SERVIDOR, não a tela: um `curl` passaria por cima de um botão
   escondido. Mesmo molde de `INTEGRACAO_NFSE_LOTE`;
2. **`regra.lancaSozinha`** daquele fornecedor — fornecedor a fornecedor, nunca a carteira inteira;
3. **a FAIXA `valorMin`/`valorMax`** — nota fora dela **cai na fila**, com o motivo dizendo que
   existe regra. Ela nunca lança e nunca some.

⚠ E mais duas recusas: **sem CNPJ** (a âncora aqui é só ele — a de descrição *se parece*, não
identifica, e o que está em jogo é um lançamento sem clique) e **sem `diaDoLancamento`** (a data não
se arbitra).

### ⚠⚠ O CRÉDITO É RECUSADO SE NÃO FOR DISPONIBILIDADE

Resposta do dono: *"continua sendo disponibilidade (caixa/banco)"*. Quem decide é
`entraNoFluxoDeCaixa` (`accounting/lib/disponibilidades.js`), REUSADA — pelo **prefixo do
`codigoCompleto`**, nunca pelo nome. ⚠ **NÃO reescrever como `!== NAO_DISPONIVEL`**: com isso
`DISPONIVEL_NAO_CLASSIFICADO` e `INDETERMINADO` entrariam.

⚠ `contaCredito` **`null` continua valendo**: é *"esta regra não escolheu crédito"*, e o caixa
cravado de hoje segue para ela. A ausência não é recusada; o que é recusado é a escolha ERRADA.

### ⚠⚠ A DATA PRESUMIDA — a decisão que eu recomendei contra

`D despesa / C caixa` no dia N **afirma que o dinheiro saiu do caixa no dia N**, e ninguém provou
isso: a nota diz o que é e de quem, nunca quando. É a única regra desta casa que este pedido
atravessa (*"a data vem da nota, do OFX ou do cliente — nunca do clique"*).

**O que torna a decisão REVERSÍVEL, e cada item é código:**

1. **`ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA`** — valor PRÓPRIO. ⚠ Reusar `DECLARADO_PELO_CONTADOR`
   atribuiria ao contador um ato que ele não praticou naquele mês. `ehProvaDePagamento` devolve
   `false`;
2. ⚠⚠ **o EXTRATO CORRIGE a data** (`CORRIGIR_DATA_PRESUMIDA`) **sem criar um segundo lançamento** —
   o `AccountingEntry` que existe é atualizado na MESMA transação, e SÓ a data;
3. **o extrato de "lançados por regra" com desfazer em lote** — o pré-requisito que o próprio
   `motorDeSugestao.js` nomeou.

⚠ `usuarioId: "regra_automatica"` nomeia a automação: pôr o id de uma pessoa diria que ela praticou
o ato.

### ⚠⚠ `CORRIGIR_DATA_PRESUMIDA` NÃO É `PROVAR_PAGAMENTO` COM OUTRO NOME

| | sai de | troca |
|---|---|---|
| `PROVAR_PAGAMENTO` | `A_CONFERIR` | a afirmação de uma **PESSOA** por uma prova |
| `CORRIGIR_DATA_PRESUMIDA` | `CONTABILIZADO` | uma presunção do **SISTEMA** por uma prova |

⚠⚠ A guarda é `origemPagamento === PRESUMIDO_POR_REGRA`, **igualdade exata** — nunca
`!ehProvaDePagamento(...)`: com a negação, a data que o contador DECLAROU seria sobrescrita por este
caminho, e ela não é uma presunção do sistema.

⚠⚠ **O COMENTÁRIO DA MATRIZ JÁ AVISAVA DISTO:** *"`CONTABILIZADO` fica fora porque lá a data já
virou a data do `AccountingEntry` — trocá-la aqui deixaria lançamento e declarado discordando."* O
argumento continua inteiro, e é ele que obriga a atualização do `AccountingEntry` na mesma transação.

### ⚠⚠ O EXTRATO — o critério é a ORIGEM, nunca o `regraId`

Um lançamento que o contador confirmou **à mão** sobre uma nota com regra também tem `regraId`, e
ele não nasceu sozinho. Confundir os dois faria o extrato oferecer "desfazer" sobre o trabalho dele.

⚠ O desfazer é **UM A UM**, por dentro de `aplicarTransicao(DESFAZER)` — nada de `deleteMany` nem
SQL cru, que deixariam lançamento órfão no razão. ⚠ **O que falha volta NOMEADO e o lote NÃO PARA**:
uma linha em mês fechado não pode impedir o contador de desfazer as outras vinte.

### ⚠⚠ A SÉRIE QUE ENTRA NO FLUXO SOZINHA — `mediana ± 10%`

> *"se a variação for = ou menor que 10%, pode ser lançado no fluxo automaticamente"* · os 10%
> governam ***"a entrada no FLUXO (a projeção)"***, medidos ***"contra a MEDIANA observada"***.

⚠⚠ **Isto é OUTRA coisa que o lançamento automático** — governa a PROJEÇÃO que o cliente vê, e não
cria `AccountingEntry` nenhum. Ver `fluxo/lib/recorrencia.js` (`podeAutoAtivar`).

⚠⚠ **AS DUAS LEITURAS DE "VARIAÇÃO" DISCORDAM NO PRÓPRIO EXEMPLO DO DONO:** a série da Lente
(1.000 · 1.050 · 1.180) tem mediana 1.050 e faixa 945–1.155 — **o 1.180 fica FORA**. Pelo
coeficiente de variação (≈ 8,6%) ela passaria. Implementada a **FAIXA**, por ser o que a resposta
dele descreve com número e por ser a mais estrita. ⚠ Consequência: **o Alessandro Nigro continua
pedindo o clique dele**.

### ✅ O QUE FALTAVA — entregue em 30/08/2026

⚠⚠ **A LISTA ABAIXO ERA A CONDIÇÃO PARA LIGAR**, escrita pelo próprio `motorDeSugestao.js` antes de
a automação existir. Ela está cumprida, e fica aqui como registro do que sustenta a decisão:

- ✅ **`lancarPorRegra` LIGADO na varredura de notas** (`lancarPorRegraNaEmpresa`), ao lado da
  auto-ativação das séries. ⚠ Ele **não pode derrubar a varredura**: falhou ⇒ `lancadosPorRegra:
  null`, que é *"não sei"* — nunca zero;
- ✅ **`CORRIGIR_DATA_PRESUMIDA` LIGADA em `fundirPagamentoNaNota`**, com o `AccountingEntry`
  atualizado na MESMA transação e **nenhum criado**. ⚠ Ela ganhou junto a guarda de **mês fechado**,
  que a fusão não precisava antes — até aqui ela não encostava no razão;
- ✅ `LEITURA_DA_CANDIDATA.DATA_PRESUMIDA` — a nota contabilizada por REGRA voltou a ser fusível, e a
  contabilizada por uma PESSOA continua não sendo. ⚠ A distinção é a ORIGEM, por igualdade exata;
- ✅ as **rotas** `GET .../conferencia/lancados-por-regra?competencia=` e
  `POST .../lancados-por-regra/desfazer`. ⚠⚠ **As duas ficam ANTES do curinga
  `/conferencia/:declaradoId/*`** — registradas depois, o `POST` do desfazer cairia em
  `/conferencia/:declaradoId/desfazer` com `declaradoId: "lancados-por-regra"`, sem erro nenhum;
- ✅ as **duas telas**, dentro da Conferência: o extrato ANTES das regras (a consequência antes da
  causa) e as regras por último, que é a tela mais perigosa da aba;
- ✅ as **migrations aplicadas no banco local**.

### ⚠⚠ O QUE APARECEU AO LIGAR — e não estava na lista

**`lancaSozinha` e `diaDoLancamento` NÃO TINHAM ESCRITOR.** As duas colunas existiam no schema e
nenhum caminho as gravava: `criarRegraManual` não as aceitava e o `PATCH` só mexia em `ativa`.
Ligar a automação fornecedor a fornecedor era **impossível pela aplicação**. Hoje há duas portas, e
as duas passam por `automaticoOuNulo`, que exige o que o motor exige:

- ⚠⚠ **SEM CNPJ não liga** (`AUTOMATICO_SEM_CNPJ`) — a âncora de descrição *se parece*, não
  identifica, e aqui não há clique de ninguém;
- ⚠⚠ **SEM DIA não liga** (`SEM_DIA_DO_LANCAMENTO`) — a data não se arbitra;
- ⚠ **DESLIGAR sempre passa**, e limpa o dia junto: não há o que conferir para PARAR de lançar, e
  recusar aqui prenderia o contador numa automação que ele quer desligar.

Aceitar aqui o que o motor recusa depois produziria o pior desfecho desta tela: uma regra marcada
*"lança sozinha"* que **nunca lança**, com o contador achando que a despesa dele está entrando.

## O que ainda **não** existe

| | |
|---|---|
| ~~a regra lançando sozinha~~ | ⚠⚠ **CONSTRUÍDA em 29/08 e LIGADA em 30/08/2026.** As travas continuam: a flag do ambiente **e** `lancaSozinha` daquele fornecedor **e** a faixa. Ver a seção da Fase 6 acima |
| ~~a tela de regras~~ | ⚠ **CONSTRUÍDA em 30/08/2026** — `PainelDeRegras.jsx`, dentro da Conferência |
| tela do cliente (import de OFX **e de Excel**) | as rotas existem; o portal do cliente ainda não as chama |
| a tela do MAPEAMENTO do extrato | as rotas existem; o painel do contador ainda não foi desenhado |
| ⚠⚠ **a migração do MAPEAMENTO aplicada** | `20260828120000`. **Sem ela o extrato em Excel não roda fora do mock** — é decisão do dono. ⚠⚠ **`20260824120000` e `20260824160000` JÁ ESTÃO APLICADAS** — esta linha dizia o contrário, e a medição abaixo desfez |

## Migration

`20260824120000_add_conferencia_lancamentos` — **ADITIVA e INERTE**, ✅ **APLICADA EM PRODUÇÃO** (medido em 28/08/2026, `prisma migrate status`: 133 migrations, e ela não está entre as pendentes).
⚠⚠ **Este parágrafo dizia "NÃO APLICADA" até hoje**, e a frase envelheceu calada — o padrão que este repositório já registrou várias vezes. Ela fica corrigida, e não apagada, porque o resto do bloco (o porquê dos dois CHECK, a conferência contra `migrate diff`) continua valendo.
Três tabelas novas; nenhuma coluna existente é tocada. Subir o código antes de aplicar não quebra
nada (o que não funciona é a fila). O SQL foi conferido coluna a coluna contra
`prisma migrate diff --from-empty`: zero divergência. Os únicos extras são os dois `CHECK`
(`chk_regra_tem_ancora`, `chk_regra_faixa_coerente`), que o Prisma não modela.

`20260824160000_add_ofx_import` — **ADITIVA e INERTE**, ✅ **APLICADA EM PRODUÇÃO** (mesma medição). Cria **uma** tabela,
`ofx_imports` (o registro de cada arquivo subido), com dois índices e a FK para `PortalClient`.
⚠ **Nenhuma coluna nova no declarado**: `fitId`, `ofxImportId`, `contaBancariaRef`, `hashDedupe` e
`parDeclaradoId` já vieram na migration de B1 — o modelo foi desenhado com o pagamento em mente.

## Testes

```bash
npx jest --config apps/api/jest.config.js --testPathPatterns "declarado|formaDoLancamento|estadosDeclarado|conferenciaRota|dedupeOfx|casamentoPagamento|importOfx|ofxImport"
```

**Experimentos executados** (o que cai quando a guarda é desligada):

| desligando | vermelhos |
|---|---|
| a invariante do caixa | **5** |
| a data do pagamento → data do documento, e o reduzido `"5"` cravado | **2** |
| o `update` para FORA da `$transaction` | **2** |
| a exigência da **pista do fornecedor** no casamento | **6** |
| a ambiguidade passando a **escolher o primeiro** candidato | **1** |

⚠ **Limite declarado:** com dublê, `$transaction` **não faz rollback de verdade** — isso é do
Postgres e não é exercido aqui. Os testes provam que as duas escritas acontecem dentro do mesmo
`$transaction` (o dublê dá funções **diferentes** a `tx` e ao client, senão a asserção não provaria
nada) e que uma falha no meio impede a segunda.
