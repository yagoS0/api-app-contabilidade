# Lista de Serviço Nacional (cTribNac) — artefato oficial versionado

Mesma regra de `docs/leiaute-nfse/` e `docs/leiaute-efd-contribuicoes/`: tabela de código fiscal
**não se transcreve de memória nem se deduz por analogia** — ela entra no repositório como artefato
oficial, com URL, data, contagem e hash, e o código é gerado a partir dela.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx` | `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx` | 2026-08-16 |

83.277 bytes, `Microsoft Excel 2007+`,
SHA-256 `a588fea05010a037826d826dd74520e32651bee926f2faa1ffd2794fba55d424`.

Página de origem: **`https://www.gov.br/nfse/pt-br/mei-e-demais-empresas/codigos-de-tributacao-nacional-nbs`**
("Códigos de Tributação Nacional / NBS", portal `gov.br/nfse`).

Duas abas:

| Aba | Linhas | Colunas |
|---|---|---|
| **`LISTA.SERV.NAC.`** | 578 (1 cabeçalho + 577 dados) | `CÓDIGO DE TRIBUTAÇÃO NACIONAL · ITEM · SUBITEM · DESDOBRO NACIONAL · DESCRIÇÃO` |
| `LISTA.NBS_v2.0` | 1.211 | `CÓDIGO NBS · DESCRIÇÃO` — **não usada** (o `cNBS` é campo opcional da DPS e ninguém o preenche neste projeto) |

## ⚠ O `cTribNac` NÃO é o item da LC 116

Ele é **`item(2) + subitem(2) + desdobro nacional(2)` = 6 dígitos**. O item LC 116 `31.01` é
"Serviços técnicos em edificações, eletrônica, eletrotécnica, mecânica, telecomunicações e
congêneres"; o código nacional **`310104`** é o desdobramento *"Serviços técnicos em
telecomunicações e congêneres"* — e é ele que aparece no DANFSe.

Carregar só o anexo da LC 116 daria a **granularidade errada**, e o erro sairia como nota emitida
com o serviço errado — que é silencioso. Medido nesta planilha: **41 itens**, **201 subitens** e
**335 desdobramentos selecionáveis**.

## ⚠ A armadilha: `010101` sai da planilha como `10101`

A coluna do código é **numérica**. Lida crua, ela perde o zero à esquerda: o primeiro código da
lista vira `10101` (5 dígitos), e o `cTribNac` da DPS tem 6 — a nota seria recusada, ou pior,
`padStart` cegos produziriam um código plausível e errado.

O gerador normaliza com padding para 6 **e prova o padding**: o código de cada linha é conferido
contra a concatenação das colunas `ITEM`/`SUBITEM`/`DESDOBRO NACIONAL` da própria planilha. Medido:
**335/335 conferem**; qualquer divergência **aborta** a geração em vez de gravar dado torto.

Há teste travando isso do lado do front
(`apps/web/src/lib/servicosNacionais/__tests__/servicoNacional.test.js`): o primeiro código da
lista é `"010101"`, nunca `"10101"`.

## ⚠ Linha com código VAZIO é cabeçalho de agrupamento, não serviço

242 das 577 linhas de dados não têm código: são o **nome do ITEM** (subitem 0) e o **nome do
SUBITEM** (subitem > 0, desdobro 0). Elas **não são selecionáveis** — mas não foram descartadas:
é o texto do grupo que faz alguém achar o código certo na tela. Vão para
`GRUPOS_SERVICO_NACIONAL`, com a chave sendo o **prefixo do próprio código** (2 dígitos = item,
4 = subitem). Nada é agrupado por semelhança de texto.

## Como isso vira código

```
docs/lista-servico-nacional/*.xlsx
        │
        │  node apps/api/scripts/gerar-lista-servico-nacional.mjs   (só leitura, zero rede)
        ▼
apps/web/src/lib/servicosNacionais/servicosNacionais.data.js       (gerado — não editar à mão)
        │
        ▼
apps/web/src/lib/servicosNacionais/servicoNacional.js              (a regra: busca, formatação)
```

O `.data.js` é carregado por **`import()` dinâmico** e não entra no bundle inicial — mesmo desenho
de `apps/web/src/lib/municipios/municipiosIbge.data.js` (a lista do IBGE).

## Para atualizar

1. baixe o XLSX da URL acima para esta pasta;
2. recalcule o SHA-256 e troque a data e o hash **nesta tabela**;
3. ajuste `EXTRAIDO_EM` em `apps/api/scripts/gerar-lista-servico-nacional.mjs` e rode-o;
4. `npm test -w @contabilidade/web` — os testes travam contagem, padding e o primeiro código.

## ⚠ O que esta lista NÃO resolve

- **A lista de códigos do MUNICÍPIO (`cTribMun`) continua sem fonte no projeto.** Ela é publicada
  por cada prefeitura; não há tabela nacional. O campo segue **digitado**, validado só na forma.
- **Nenhum de-para CNAE → serviço.** O CNAE da empresa não determina o `cTribNac`, e inferir um do
  outro é o que a regra 1 do projeto proíbe.
- **Nada é pré-selecionado.** A lista alimenta uma ESCOLHA do contador — a mesma regra do seletor
  de município: buscar ENCONTRA, não escolhe; um único resultado não se autosseleciona.
