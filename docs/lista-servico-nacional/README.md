# Lista de Serviço Nacional (cTribNac) — artefato oficial versionado

Mesma regra de `docs/leiaute-nfse/` e `docs/leiaute-efd-contribuicoes/`: tabela de código fiscal
**não se transcreve de memória nem se deduz por analogia** — ela entra no repositório como artefato
oficial, com URL, data, contagem e hash, e o código é gerado a partir dela.

## O que está aqui

| Arquivo | Origem | Extraído em |
|---|---|---|
| `anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx` | `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx` | 2026-08-16 |
| `anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx` | [Anexo B v1.01 de 22/01/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx) | 2026-11-12 |

O gerador de cTribNac usa a v1.01, com 85.008 bytes e SHA-256 `e74b0be8ad204e458932efb1716225a3fb5703a84e5475ce5c4c6789d1c61b1a`. A versão acrescenta 141403, 141404 e 200102 e atualiza a descrição de 200101. A aba NBS é idêntica à anterior.

O arquivo histórico usado por outros consumidores tem 83.277 bytes e
SHA-256 `a588fea05010a037826d826dd74520e32651bee926f2faa1ffd2794fba55d424`.

O Portal Nacional publica a versão vigente na [Documentação Atual de Produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual), em **Anexos de Domínio**. A página [Códigos de Tributação Nacional / NBS](https://www.gov.br/nfse/pt-br/mei-e-demais-empresas/codigos-de-tributacao-nacional-nbs) foi a origem da cópia histórica.

Duas abas:

| Aba | Linhas | Colunas |
|---|---|---|
| **`LISTA.SERV.NAC.`** | 581 (1 cabeçalho + 580 dados) | `CÓDIGO DE TRIBUTAÇÃO NACIONAL · ITEM · SUBITEM · DESDOBRO NACIONAL · DESCRIÇÃO` |
| `LISTA.NBS_v2.0` | 1.211 | `CÓDIGO NBS · DESCRIÇÃO` |

## ⚠ O `cTribNac` NÃO é o item da LC 116

Ele é **`item(2) + subitem(2) + desdobro nacional(2)` = 6 dígitos**. O item LC 116 `31.01` é
"Serviços técnicos em edificações, eletrônica, eletrotécnica, mecânica, telecomunicações e
congêneres"; o código nacional **`310104`** é o desdobramento *"Serviços técnicos em
telecomunicações e congêneres"* — e é ele que aparece no DANFSe.

Carregar só o anexo da LC 116 daria a **granularidade errada**, e o erro sairia como nota emitida
com o serviço errado — que é silencioso. Medido nesta planilha: **41 itens**, **201 subitens** e
**338 desdobramentos selecionáveis**.

## ⚠ A armadilha: `010101` sai da planilha como `10101`

A coluna do código é **numérica**. Lida crua, ela perde o zero à esquerda: o primeiro código da
lista vira `10101` (5 dígitos), e o `cTribNac` da DPS tem 6 — a nota seria recusada, ou pior,
`padStart` cegos produziriam um código plausível e errado.

O gerador normaliza com padding para 6 **e prova o padding**: o código de cada linha é conferido
contra a concatenação das colunas `ITEM`/`SUBITEM`/`DESDOBRO NACIONAL` da própria planilha. Medido:
**338/338 conferem**; qualquer divergência **aborta** a geração em vez de gravar dado torto.

Há teste travando isso do lado do front
(`apps/web/src/lib/servicosNacionais/__tests__/servicoNacional.test.js`): o primeiro código da
lista é `"010101"`, nunca `"10101"`.

## ⚠ Linha com código VAZIO é cabeçalho de agrupamento, não serviço

242 das 580 linhas de dados não têm código: são o **nome do ITEM** (subitem 0) e o **nome do
SUBITEM** (subitem > 0, desdobro 0). Elas **não são selecionáveis** — mas não foram descartadas:
é o texto do grupo que faz alguém achar o código certo na tela. Vão para
`GRUPOS_SERVICO_NACIONAL`, com a chave sendo o **prefixo do próprio código** (2 dígitos = item,
4 = subitem). Nada é agrupado por semelhança de texto.

## Como isso vira código

```
docs/lista-servico-nacional/anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx
        │
        │  node apps/api/scripts/gerar-lista-servico-nacional.mjs   (só leitura, zero rede)
        ▼
apps/web/src/lib/servicosNacionais/servicosNacionais.data.js       (gerado — não editar à mão)
        │
        ▼
apps/web/src/lib/servicosNacionais/servicoNacional.js              (a regra: busca, formatação)
```

O `.data.js` é carregado por **`import()` dinâmico** e não entra no bundle inicial — mesmo desenho
de `packages/shared/src/municipios/municipiosIbge.data.js` (a lista do IBGE).

⚠ A lista do IBGE virou **arquivo único** em 20/08/2026 (era cópia nos dois portais). Esta lista
aqui **continua em duas cópias**, escritas pelo gerador nos dois destinos — são tabelas diferentes e
a consolidação de uma não consolidou a outra.

## Para atualizar

1. localize o Anexo B vigente na documentação de produção e baixe o XLSX com o nome da versão;
2. registre URL, data, SHA-256 e diferenças da aba `LISTA.SERV.NAC.` nesta página antes de substituir o catálogo;
3. ajuste o caminho da fonte, a URL e `EXTRAIDO_EM` em `apps/api/scripts/gerar-lista-servico-nacional.mjs` e rode-o. O gerador de NBS continua usando seu próprio caminho versionado;
4. `npm test -w @contabilidade/web` — os testes travam contagem, padding e o primeiro código.

## ⚠ O que esta lista NÃO resolve

- **A lista de códigos do MUNICÍPIO (`cTribMun`) continua sem fonte no projeto.** Ela é publicada
  por cada prefeitura; não há tabela nacional. O campo segue **digitado**, validado só na forma.
- **Nenhum de-para CNAE → serviço.** O CNAE da empresa não determina o `cTribNac`, e inferir um do
  outro é o que a regra 1 do projeto proíbe.
- **Nada é pré-selecionado.** A lista alimenta uma ESCOLHA do contador — a mesma regra do seletor
  de município: buscar ENCONTRA, não escolhe; um único resultado não se autosseleciona.
