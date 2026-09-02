# Retenção na fonte sobre serviços — artefatos oficiais versionados

Mesma regra de `docs/lc116/`, `docs/lista-servico-nacional/`, `docs/leiaute-nfse/` e
`docs/leiaute-efd-contribuicoes/`: **alíquota e regra de retenção não se transcrevem de memória nem
se deduzem por analogia** — entram no repositório como artefato oficial, com URL, data, tamanho,
codificação e hash, e o código é **gerado** por um script que **aborta** na divergência.

⚠⚠ **POR QUE ISTO EXISTE.** O grupo `tribFed` da DPS (`piscofins`, `vRetCSLL`, `vRetIRRF`, `vRetCP`)
está escrito no gerador e **nunca teve produtor** — `return ""` em 100% das emissões, e retenção
declarada é RECUSADA (`NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA`). Para o Lucro Presumido emitir com
retenção, alguém precisa produzir números. **Medido em 01/09/2026: o repositório inteiro não tinha
uma linha sobre retenção na fonte** — varredura por `4,65`, `10.833`, `459/2004`, `765/2007` e
`13.137` em `apps/` e `docs/` devolvia **uma única ocorrência**, e ela era a COFINS **não cumulativa
de 7,6%** do Lucro Real (`docs/fontes-fiscais.md:506`), que é **apuração, não retenção**.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `l10833compilado.htm` | `https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm` | 2026-09-01 |
| `in-srf-459-2004-vigente.json` | `https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/15365/visao/vigente` | 2026-09-01 |
| `in-rfb-765-2007-vigente.json` | `https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/15713/visao/vigente` | 2026-09-01 |

| Arquivo | Tamanho | Codificação | SHA-256 |
|---|---|---|---|
| `l10833compilado.htm` | 268.000 bytes | **ISO-8859-1** | `2a22828df7d34073f49430194031e794263a70cf3dec1a7b77ada28670bfe7ec` |
| `in-srf-459-2004-vigente.json` | 52.727 bytes | UTF-8 | `3935f607efa38446566765dd2c0c0eac353a2cc3999b6e6ddcb91140eff77e2f` |
| `in-rfb-765-2007-vigente.json` | 14.411 bytes | UTF-8 | `c156f3086aa9b0abeb9a3b2aac5560a71035c7bccbe854706ca14a2ff4e7a0f0` |

⚠ O `l10833compilado.htm` é o **texto compilado** — a Lei 10.833/2003 já com as alterações
posteriores, inclusive a **Lei 13.137/2015**. Por isso a 13.137 **não** é versionada à parte: o piso
de R$ 10,00 e a revogação do § 4º já estão no corpo deste arquivo, com a marca
`(Redação dada pela Lei nº 13.137, de 2015)` ao lado — que é o que o gate confere.

## As quatro armadilhas destas fontes

**1. O Planalto recusa `curl` sem `User-Agent`.** A conexão fica pendurada até o timeout, sem
resposta e sem erro. Já está escrito em `docs/lc116/README.md`; repetido aqui porque quem for
rebaixar achará que o site caiu. Com `-A "Mozilla/5.0 …"` responde em ~1,3 s.

**2. `normas.receita.fazenda.gov.br` é um REDIRECIONADOR para uma SPA — `curl` ali devolve casca.**
`link.action?idAto=NNNNN` responde **200 com 2.639 bytes** de JavaScript que faz
`window.location.replace` para `normasinternet2…/#/consulta/externa/NNNNN`. O fragmento (`#`) nunca
chega ao servidor, então não há como buscar o texto por aquele caminho.
O endereço que serve o conteúdo é a **API da SPA**:

```
https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/<idAto>/visao/vigente
```

⚠ **Ela exige `Referer`.** Sem ele responde **403**; com `-H "Referer: https://normasinternet2.receita.fazenda.gov.br/"`
responde 200 `application/json`. Foi descoberta lendo as requisições da própria página no navegador,
não adivinhada.

**3. ⚠⚠ O JSON traz AS DUAS REDAÇÕES do mesmo dispositivo, interleavadas** — exatamente a armadilha
que a LC 116 já paga no HTML do Planalto. Cada item de `outrosSegmentos` tem `versaoSegmento`,
`omitir`, `tachado`, `original` e `compilado`. O art. 3º, II da IN 459 aparece **duas vezes**:

| versão | `omitir` | `compilado` | texto |
|---|---|---|---|
| 1 | **true** | false | *"II - pessoas jurídicas optantes pelo **Simples**, em relação às suas receitas próprias."* |
| 2 | false | **true** | *"II - pessoas jurídicas optantes pelo **Regime Especial Unificado … (Simples Nacional)**, de que trata o art. 12 da LC 123/2006, em relação às suas receitas próprias."* |

Lido cru, sai a redação **revogada** — ou as duas. O filtro é `compilado === true && omitir !== true`
(medido: **70 de 76** segmentos na IN 459).

**4. O texto do Planalto mistura separadores.** `&#150;` (travessão CP1252, U+0096) aparece ao lado
de hífens comuns, e o arquivo é **ISO-8859-1 com CRLF** — lido como UTF-8, todo acento vira U+FFFD.
Mesma armadilha da LC 116.

⚠ `.gitattributes` já cobre `docs/** -text` desde 25/08/2026, então o git **não** converte quebra de
linha nestes arquivos e os hashes acima continuam conferindo. Não mexa nisso.

## O que o gerador produz

`node apps/api/scripts/gerar-tabelas-retencao.mjs` →
`apps/api/src/application/fiscal/retencao/retencao.data.js`

**Zero rede.** Ele lê os três arquivos desta pasta, confere o SHA-256 de cada um e **aborta** se
qualquer literal do gate não for encontrado no documento.

## O que ficou PROVADO nesta rodada

| regra | dispositivo | onde |
|---|---|---|
| retenção de CSLL+COFINS+PIS sobre serviços | **Lei 10.833/2003, art. 30, caput** | `l10833compilado.htm` |
| **4,65%** = 1% (CSLL) + 3% (COFINS) + 0,65% (PIS/PASEP) | **art. 31, caput** | idem |
| dispensa de retenção **≤ R$ 10,00**, exceto DARF eletrônico via Siafi | **art. 31, § 3º** (Lei 13.137/2015) | idem |
| a soma mensal de pagamentos para aferir o antigo limite foi **REVOGADA** | **art. 31, § 4º — "(Revogado)"** (Lei 13.137/2015) | idem |
| **PJ optante pelo Simples NÃO sofre** essa retenção | **art. 32, III** | idem |
| … regulamentado, com a redação atual | **IN SRF 459/2004, art. 3º, II** | `in-srf-459-2004-vigente.json` |
| … e a optante **deve entregar declaração** (Anexo I, 2 vias) à tomadora | **IN SRF 459/2004, art. 11** | idem |
| **IRRF dispensado** sobre importâncias pagas a PJ do Simples Nacional | **IN RFB 765/2007, art. 1º** | `in-rfb-765-2007-vigente.json` |
| … exceto rendimentos de aplicações (LC 123, art. 13, § 1º, V) | **IN RFB 765/2007, art. 1º, § único** | idem |

⚠⚠ **A DISPENSA DO SIMPLES ESTÁ NA LEI, NÃO SÓ NA IN.** É o **art. 32, III** da própria Lei 10.833
que diz que a retenção *"não será exigida na hipótese de pagamentos efetuados a … III - pessoas
jurídicas optantes pelo SIMPLES"*. A IN 459 regulamenta e atualiza o nome do regime. Uma primeira
pesquisa deste projeto atribuiu a regra **só** à IN — está corrigido aqui, com a fonte primária.

⚠ **NÃO CONFUNDA O ART. 30, § 2º COM O ART. 32, III.** São lados opostos da mesma operação:

| dispositivo | sobre quem |
|---|---|
| art. 30, § 2º | quem **PAGA** — a fonte pagadora optante pelo Simples não é obrigada a reter |
| **art. 32, III** | quem **RECEBE** — não se retém de prestador optante pelo Simples |

Para a NFS-e o que vale é o **art. 32, III**: nosso cliente é o prestador.

## ⚠⚠ O que NÃO está provado aqui — e por isso NÃO virou dado

Nomeado em vez de suposto (regra 1 do projeto):

| falta | por quê |
|---|---|
| **alíquota do IRRF sobre serviços (o "1,5%")** | não está na Lei 10.833. Ela vive na legislação do imposto de renda (Lei 7.713/1988 e RIR), **não versionada aqui**. A IN 765 prova a **dispensa** para o Simples, não a alíquota do Presumido. |
| **retenção previdenciária de 11% (`vRetCP`)** | Lei 8.212/1991, art. 31 (cessão de mão de obra e empreitada) e a interação com o **Anexo IV** do Simples — **nenhuma das duas confirmada**. O campo existe no leiaute e fica **sem produtor**. |
| **a lista fechada dos "serviços profissionais"** do art. 30 | o caput remete ao rol do IRRF, que não está versionado. **Quem declara se o serviço está na lista é o contador, por perfil** — o sistema não deriva do CNAE. Derivar erraria nos dois sentidos: declarar retenção indevida, ou omitir a devida. |
| **retenção por órgão público federal** | IN RFB 1.234/2012 tem tabela e alíquotas próprias, por natureza do serviço. É outro regime, não um caso do art. 30. |
| **ISS retido no Simples** (LC 123, arts. 13 § 1º, 18 § 6º, 21 § 4º) | a LC 123 **não está versionada** neste repositório. É retenção MUNICIPAL e pertence à fase do `tribMun`; fica nomeada aqui para quem for buscá-la saber quais artigos importam. |

## Como rebaixar os artefatos

```bash
curl -sS -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" \
  -o docs/retencao-fonte/l10833compilado.htm \
  "https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm"

for id in 15365:in-srf-459-2004 15713:in-rfb-765-2007; do
  curl -sS -A "Mozilla/5.0" -H "Accept: application/json" \
    -H "Referer: https://normasinternet2.receita.fazenda.gov.br/" \
    -o "docs/retencao-fonte/${id#*:}-vigente.json" \
    "https://normasinternet2.receita.fazenda.gov.br/api/consulta-externa/ato/${id%%:*}/visao/vigente"
done
```

Depois rode o gerador: ele confere os hashes e **aborta** se o conteúdo divergir do que está
tabelado acima.
