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

## O que ainda **não** existe

| | |
|---|---|
| **backfill do histórico** | Fase C0. ⚠ O prêmio medido são **77 pares** unânimes, não "milhares" |
| aprendizado e regras | Fase C. `RegraContabilizacao` já existe no schema, **sem escritor ainda** |
| **tela** | ainda não há nenhuma — nem a do contador, nem a do cliente |

## Migration

`20260824120000_add_conferencia_lancamentos` — **ADITIVA e INERTE**, ⚠ **NÃO APLICADA**.
Três tabelas novas; nenhuma coluna existente é tocada. Subir o código antes de aplicar não quebra
nada (o que não funciona é a fila). O SQL foi conferido coluna a coluna contra
`prisma migrate diff --from-empty`: zero divergência. Os únicos extras são os dois `CHECK`
(`chk_regra_tem_ancora`, `chk_regra_faixa_coerente`), que o Prisma não modela.

`20260824160000_add_ofx_import` — **ADITIVA e INERTE**, ⚠ **NÃO APLICADA**. Cria **uma** tabela,
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
