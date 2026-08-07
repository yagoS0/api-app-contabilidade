# EFD-Contribuições — onde paramos (07/08/2026)

Ponto de retomada. A funcionalidade está **desligada em produção e no mock**, por decisão do dono, e
vai ser desenvolvida em separado. Nada foi apagado.

---

## ⚠⚠ LEIA PRIMEIRO: a obrigação tem prazo de validade

**NT 011/2026** (03/02/2026, PDF em `docs/leiaute-efd-contribuicoes/`). Reforma tributária
(EC 132/2023 + LC 214/2025):

- A EFD-Contribuições **deixa de receber novos fatos geradores a partir de 01/2027**, quando a CBS
  passa a alíquota plena e PIS/Cofins são extintos.
- **Não** é desligada: manter, consultar e **retificar** persiste por **no mínimo 5 anos** — é o que
  viabiliza usar os saldos credores de PIS/Cofins acumulados até 31/12/2026 contra a CBS.
- **Sem alteração de leiaute** para CBS/IBS/IS em 2026, e esses valores **não** entram nos registros
  atuais.

**A decisão que isso força:** um gerador construído hoje serve a **~5 competências de fatos
geradores novos** (08/2026 a 12/2026) e depois vira ferramenta de **retificação** por 5 anos. Isso
não zera o valor — retificar sem gerador é o mesmo trabalho manual de sempre — mas é um investimento
diferente do que a especificação original supunha. **Decidir isso é o primeiro passo da retomada**,
antes de escrever qualquer linha de gerador.

---

## Como destravar (dois lugares, de propósito)

| Onde | O quê |
|---|---|
| `apps/web/src/features/obrigacoes/entregas/lib/liberacao.js` | `ENTREGA_POR_ARQUIVO_LIBERADA = false` → `true` |
| `apps/api/src/routes/firm/obrigacoes.js` | `const ENTREGA_ARQUIVO_LIBERADA = false` → `true` |

São dois porque um só não basta: apenas a tela deixaria a rota aberta a uma aba já carregada;
apenas a rota deixaria a tela oferecendo o que o backend recusa (503 `ENTREGA_ARQUIVO_DESLIGADA`).

⚠ **O banco NÃO foi tocado ao desligar.** A tabela `entregas_obrigacao_arquivo` e a migration
`20260806140000_add_entrega_obrigacao_arquivo` continuam aplicadas. Se algum dia houver dado gravado
ali, **reveja a decisão de esconder a tela**: hoje esconder é seguro porque nunca esteve em produção
e ninguém registrou nada; com dado gravado, sumir passaria a esconder trabalho já feito.

---

## O que ESTÁ pronto

### 1. Rastro da entrega (`EntregaObrigacaoArquivo`)
Modelo **genérico** — serve EFD-Contribuições, ECD, ECF e EFD-Fiscal, que têm o mesmo ciclo.
`competencia` aceita `"YYYY-MM"` (mensais) e `"YYYY"` (anuais). Rotas `GET`/`PUT` em
`routes/firm/obrigacoes.js`; par mock/real em `src/api/`.

Três passos na tela, cada um dizendo **onde acontece**: gerar (fora do app) · validar/assinar/
transmitir (no PVA) · anexar recibo (aqui). O PUT **só toca o que foi enviado** (anexar recibo não
apaga o arquivo), e `transmitida: false` desfaz.

⚠ **Só o NOME do arquivo é guardado hoje**, não o conteúdo — o upload de verdade não foi feito.

### 2. Regra de obrigatoriedade (`entregas/lib/obrigatoriedadeEfd.js`, 19 testes)
Optante do Simples Nacional **não entrega** (IN RFB 1.252/2012; Guia v1.35, Cap. I, Seção 3). Três
respostas: `obrigada`, `dispensada`, **`indefinida`** (sem regime cadastrado não se afirma nada).
Início da obrigatoriedade: Lucro Real 01/2012, Presumido/arbitrado 01/2013 — **datas diferentes**.
Dispensas que dependem de dado que não temos (imunidade ≤ R$ 10 mil, mês sem receita, inatividade)
não são aplicadas: viajam nomeadas junto da obrigação.

⚠ Esta parte **é independente do gerador** e continua correta. Se a retomada decidir não construir
gerador nenhum, esta regra ainda vale.

### 3. Passo zero — artefatos oficiais versionados (`docs/leiaute-efd-contribuicoes/`)
- **Guia Prático v1.35** (18/06/2021, versão vigente), 4.105.830 bytes, SHA-256 no README.
- **NT 011/2026** e **NT 012/2026**.
- **21.955 linhas em 74 tabelas** de códigos, colhidas por
  `apps/api/scripts/baixar-tabelas-efd-contribuicoes.mjs` — re-executável, porque são **dados por
  vigência**.

⚠ A rota de download do SPED é **`/arquivo/download/<id>`**. Não há `href="*.pdf"` no HTML; quem
procurar por isso conclui que a fonte não publica o arquivo.

O README de lá documenta as **três armadilhas** que fizeram a colheita mentir parecendo íntegra
(filtro que descartava as tabelas de código de receita; paginação de 50 em 50 que escondia 91% das
linhas; filtro de paginador por conteúdo que apagou uma tabela inteira). Ler antes de mexer no
script.

---

## O que FALTA

### O gerador do arquivo
Os insumos existem. Falta escrever registro a registro contra o Guia. Escopo Fase 1 (Lucro
Presumido, escrituração consolidada, ADE Cofis 24/2011): `0000, 0001, 0100, 0110, 0120, 0140`,
`F001, F010, F550` (competência) **ou** `F500 + F525` (caixa), `F600`, `M200/M210/M205`,
`M600/M610/M605`, `1900`, `9001/9900/9990/9999`.

Pontos já levantados, para não redescobrir:
- **NT 012/2026 (LC 224/2025):** **não** se altera o CST. O ajuste vai em `M220/M225` (PIS) e
  `M620/M625` (Cofins) como **acréscimo**, vinculado a um `M210/M610` de `COD_CONT` **01**
  (não cumulativa alíquota básica) ou **51** (cumulativa alíquota básica) — e, **não existindo esse
  M210/M610, ele deve ser criado**. Fórmula na IN RFB 2.305/2025, art. 7º.
- **Exclusão do ICMS da base (RE 574.706):** no caminho consolidado do Presumido vai em
  `VL_DESC_PIS`/`VL_DESC_COFINS` do F500/F550, vinculado ao CST da receita correspondente — nunca
  ICMS de receita não tributada abatendo base de receita tributada.
- **Dezembro é obrigatório** mesmo sem movimento: consolida no `0120` os meses dispensados do ano.
- Estrutura: ISO-8859-1, campos entre `|`, `CR+LF`, sem linha em branco, blocos na ordem
  `0 A C D F I M P 1 9` todos presentes, `9900` com contagem por tipo de registro.

### ⚠ O gate que NÃO é executável aqui
Critério de aceite nº 1 da especificação: **importar e validar no PVA sem erros**. O PVA é programa
desktop com assinatura por certificado — não roda neste ambiente. O arranjo combinado com o dono foi:
o agente gera com casos dourados calculados à mão contra o Guia, **o contador roda o PVA** e traz os
erros de volta.

**Sem esse ciclo, não há entrega.** Gerador escrito contra o Guia e nunca passado pelo validador é
exatamente o risco que a especificação nomeia: *arquivo aceito com dado errado é o pior*.

### Outros
- **Upload real do arquivo e do recibo** (hoje só o nome).
- **Tabelas 4.3.x/4.4.x ainda não estão ligadas a nada** — são dado bruto versionado, sem consumidor.
- A colheita das tabelas tem **2 recusas legítimas**: uma tabela cujo próprio servidor responde
  "A versão da tabela 211 não possui estrutura", e `Informativos ao Contribuinte`, que não é tabela.

---

## Commits desta linha de trabalho

| Commit | O quê |
|---|---|
| `f2d4fed1` | Modelo, migration, rotas, mock/real e a tela dos três passos |
| `87abab36` | Regra de obrigatoriedade (Simples não entrega) + Guia Prático versionado |
| `35141f63` | NTs 011 e 012 de 2026 + as 74 tabelas + o script de colheita |
