# Lista de serviços da LC 116/2003 — artefato oficial versionado

Mesma regra de `docs/lista-servico-nacional/`, `docs/leiaute-nfse/` e
`docs/leiaute-efd-contribuicoes/`: tabela de código fiscal **não se transcreve de memória nem se
deduz por analogia** — ela entra no repositório como artefato oficial, com URL, data, contagem e
hash, e o código é **gerado** a partir dela por um script que **aborta** na divergência.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `lcp116.htm` | `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm` | 2026-08-25 |

104.392 bytes, HTML, **ISO-8859-1**,
SHA-256 `1de1de107d8957a9314b9418d1f158e5ebb25ec5b452694d615290f2853801e2`.

É o **texto compilado** — a LC 116/2003 já com as alterações da **LC 157/2016**.

⚠ **O Planalto recusa `curl` sem `User-Agent`** (a conexão fica pendurada até o timeout, sem
resposta e sem erro). Com `-A "Mozilla/5.0 …"` responde em 0,4 s. Quem for rebaixar o arquivo e
achar que o site caiu: é isto.

## O que o gerador produz

`node apps/api/scripts/gerar-lista-lc116.mjs` →
`apps/api/src/application/fiscal/lc116/lc116.data.js`

Medido na fonte, e travado no gate:

| | |
|---|---|
| itens | **40** |
| subitens brutos no HTML | **213** |
| subitens que vêm em DUAS redações | **8** |
| subitens finais | **205** (dos quais **5 vetados**) |

## ⚠⚠ As três armadilhas desta fonte — todas custaram uma execução abortada

**1. O separador não é um hífen.** Entre o número e o nome do serviço vem `&#150;` — o travessão do
CP1252 (U+0096) —, e não `-`. Tratando só as entidades **nomeadas**, o extrator achou **1 item de
40**. O gate abortou em vez de escrever a lista mutilada, que é exatamente para isso que ele existe.
O documento **mistura** os separadores: 187 entradas usam `&#150;` e 26 usam hífen comum (em geral
as redações da LC 157/2016).

**2. O texto compilado traz AS DUAS REDAÇÕES, interleavadas.** O Planalto imprime a redação
original e, logo abaixo, a alterada — as duas com o **mesmo número**. Lido cru, `1.03` sai duas
vezes, e a versão que um mapa guardaria é a **última escrita**, que pode ser a **revogada**.
Descrição revogada num documento fiscal é erro silencioso.
A regra: aparecendo o mesmo número, vence a que traz "Redação dada pela Lei Complementar …".
Sem marca em nenhuma das duas, o gerador **aborta** — eleger por posição no arquivo seria adivinhar.

**3. `"lista de serviços anexa"` aparece QUATRO vezes no corpo da lei** ("referidos nos subitens
4.22 e 4.23 da lista de serviços anexa a esta Lei Complementar"). Ancorar nela pegaria a primeira
ocorrência e começaria a extração no meio do art. 2º. A âncora é o **cabeçalho**, no início da
linha.

⚠ E a codificação é **latin-1**, não utf-8. Lida como utf-8, toda descrição vem com U+FFFD no lugar
dos acentos — e há uma prova no gerador exatamente para isso.

## ⚠⚠ A prova que decidiu o número não é a contagem

Contagem sozinha fecha por acaso: uma entrada perdida e outra duplicada dão o mesmo total. O gate
confere, além dos números, que **os subitens de cada item formam uma sequência contígua `.01` até
`.N`, sem buraco**, com os vetados ocupando o slot deles.

Foi ela que corrigiu o total: uma primeira sondagem (em Python, com uma lista de traços que **não**
incluía o `U+0096`) achou **204** subitens, e a prova de contiguidade mostrou que o certo é **205**
— a sondagem tinha **colado uma entrada no texto da anterior**, em silêncio.

## ⚠⚠ Isto NÃO é o `cTribNac` da NFS-e

| | dígitos | onde mora |
|---|---|---|
| item da **LC 116** | 4 (`N.NN`) | aqui |
| **`cTribNac`** (código de tributação nacional) | 6 (item + subitem + desdobro nacional) | `apps/web/src/lib/servicosNacionais/` |

O item `31.01` é o guarda-chuva; **`310104`** é "Serviços técnicos em telecomunicações e
congêneres", e é esse que o DANFSe imprime. Trocar um pelo outro dá **granularidade errada**, e o
erro sai como nota emitida com o serviço errado — silenciosamente.

## ⚠⚠ O que esta tabela NÃO responde

Ela **não diz o anexo do Simples**, não diz a presunção do Lucro Presumido e **não classifica
receita**. A LC 116 é a lista dos serviços sujeitos ao **ISS** — outra lei, outro tributo.

O de-para "item da LC 116 → tipo de receita / anexo" é **julgamento fiscal que não está em norma
nenhuma**. Construí-lo aqui poria receita no anexo errado **em série**, e é a mesma razão pela qual
este projeto recusa derivar CNAE→presunção de IRPJ/CSLL
(`application/planejamento/DadosPlanejamentoService.js`). Quem decide é o contador — é assunto à
parte, e ainda **não foi feito**.

O que a tabela entrega hoje, com zero inferência: **o nome do serviço a partir do código**. A tela
mostrava `17.06` cru; agora pode mostrar *"17.06 — Propaganda e publicidade, inclusive promoção de
vendas, planejamento de campanhas ou sistemas de publicidade…"*.
