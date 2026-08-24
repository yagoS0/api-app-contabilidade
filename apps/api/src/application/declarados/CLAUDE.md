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
| `DeclaradoService.js` | a ligação com o banco. **O único caminho de escrita.** 30 testes |
| `../../routes/firm/conferencia.js` | HTTP e nada mais. 29 testes |

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

## O que a Fase A **não** faz

| | |
|---|---|
| varrer as notas recebidas | Fase B1 — ⚠ com **data-piso obrigatória**: 1.897 itens de uma vez não é fila, é muro |
| OFX, matching, fusão | Fase B2 |
| aprendizado e regras | Fase C. `RegraContabilizacao` já existe no schema, **sem escritor ainda** |
| tela | ainda não há nenhuma |

## Migration

`20260824120000_add_conferencia_lancamentos` — **ADITIVA e INERTE**, ⚠ **NÃO APLICADA**.
Três tabelas novas; nenhuma coluna existente é tocada. Subir o código antes de aplicar não quebra
nada (o que não funciona é a fila). O SQL foi conferido coluna a coluna contra
`prisma migrate diff --from-empty`: zero divergência. Os únicos extras são os dois `CHECK`
(`chk_regra_tem_ancora`, `chk_regra_faixa_coerente`), que o Prisma não modela.

## Testes

```bash
npx jest --config apps/api/jest.config.js --testPathPatterns "declarado|formaDoLancamento|estadosDeclarado|conferenciaRota"
```

**Experimentos executados** (o que cai quando a guarda é desligada):

| desligando | vermelhos |
|---|---|
| a invariante do caixa | **5** |
| a data do pagamento → data do documento, e o reduzido `"5"` cravado | **2** |
| o `update` para FORA da `$transaction` | **2** |

⚠ **Limite declarado:** com dublê, `$transaction` **não faz rollback de verdade** — isso é do
Postgres e não é exercido aqui. Os testes provam que as duas escritas acontecem dentro do mesmo
`$transaction` (o dublê dá funções **diferentes** a `tx` e ao client, senão a asserção não provaria
nada) e que uma falha no meio impede a segunda.
