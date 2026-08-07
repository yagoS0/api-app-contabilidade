# Leiaute da EFD-Contribuições — artefatos oficiais versionados

Passo zero da Entrega 8: o leiaute **não se transcreve nem se deduz** — ele entra no repositório
como artefato oficial e o gerador é implementado registro a registro contra ele. Sem estes arquivos
commitados, implementação de gerador está bloqueada (mesma regra do espelho da DEFIS).

## ⚠⚠ LEIA ISTO ANTES DE INVESTIR NO GERADOR: a obrigação tem prazo de validade

**NT 011/2026 (03/02/2026), baixada aqui.** Reforma tributária (EC 132/2023 + LC 214/2025):

- A EFD-Contribuições **deixa de receber novos fatos geradores a partir de 01/2027**, quando a CBS
  passa a ser cobrada em alíquota plena e PIS/Cofins são extintos.
- Ela **não** é desligada: a obrigação de manter, consultar e **retificar** persiste pelo **prazo
  mínimo de 5 anos**, e é o que viabiliza usar os saldos credores de PIS/Cofins acumulados até
  31/12/2026 em compensação com a CBS.
- **Não haverá alteração de leiaute para CBS/IBS/IS em 2026**, e os valores desses tributos **não
  devem** ser somados aos itens ou documentos da EFD-Contribuições no ano.

Consequência prática, e é ela que muda a conta: um gerador feito hoje serve a **~5 competências de
fatos geradores novos** (08/2026 a 12/2026) e depois vira ferramenta de **retificação** por 5 anos.
Isso não zera o valor — retificar sem gerador é o mesmo problema de sempre — mas é uma decisão de
investimento diferente da que a especificação original supunha, e precisa ser tomada de olho aberto.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `Guia_Pratico_EFD_Contribuicoes_v1.35_2021-06-18.pdf` | `sped.rfb.gov.br/estatico/AD/06A0F5C4…` | 2026-08-06 |
| `NT_011_2026_descontinuidade_efd_contribuicoes.pdf` | `sped.rfb.gov.br/arquivo/download/8016` | 2026-08-07 |
| `NT_012_2026_lc224_2025.pdf` | `sped.rfb.gov.br/arquivo/download/8126` | 2026-08-07 |
| `tabelas/tabelas-2026-08-07.json` | consultor oficial (ver abaixo) | 2026-08-07 |

Guia Prático: 4.105.830 bytes, `%PDF-1.7`,
SHA-256 `60eace459169238808e3e745e952fcbbbd2af6b7f933b043e8c9692b68f4d08b`. Versão vigente segundo a
página de Manuais (`sped.rfb.gov.br/item/show/1989`), confirmada em 06/08/2026.

⚠ A rota de download dos itens do SPED é **`/arquivo/download/<id>`** — não há link `.pdf` no HTML,
e as páginas de listagem montam o conteúdo por JS. Quem procurar por `href="*.pdf"` não acha nada e
conclui que a fonte não publica o arquivo.

### NT 012/2026 — LC 224/2025 (redução linear de benefícios)

O que ela decide, e que afeta o gerador: **não se altera o CST** originalmente previsto. O ajuste da
redução vai nos registros de ajuste (**M220/M225** para PIS, **M620/M625** para Cofins), como
acréscimo, vinculado a um M210/M610 de **COD_CONT 01** (não cumulativa alíquota básica) ou **51**
(cumulativa alíquota básica) — e, **não existindo esse M210/M610, ele deve ser criado**. A fórmula
do ajuste está na IN RFB 2.305/2025, art. 7º.

## Tabelas de códigos — `tabelas/`

**21.955 linhas em 74 tabelas**, colhidas em 07/08/2026 por
`apps/api/scripts/baixar-tabelas-efd-contribuicoes.mjs`. Rodar o script de novo é como se atualiza.

⚠ **São dados por vigência, não constantes.** Quase toda tabela traz `Data de Início` / `Data de
Fim`, e só em 2026 elas mudaram quatro vezes (LC 228/2026 em 30/03; um lote em 16/04; Lei
15.394/2026 em 03/05). Hardcodá-las repetiria o erro que `tabelasFiscais.js` existe para não
cometer.

⚠ **A fonte não publica arquivo.** É um consultor ASP.NET WebForms
(`ConsultaTabelasExternas.aspx?CodSistema=SpedPisCofins`) com dois `<select>` encadeados por
postback: sem JSON, sem CSV, sem rota de download. O script exerce o mesmo postback que o navegador
exerceria.

### ⚠ As três armadilhas que fizeram a colheita mentir — todas reais, todas corrigidas

| # | O que acontecia | Estrago |
|---|---|---|
| 1 | Filtro exigia coluna `Data de Início` para reconhecer a tabela | descartava em silêncio **4.4.1 e 4.4.2 — os códigos de receita do M205/M605**, que não têm coluna de vigência. Justamente o dado mais importante |
| 2 | O grid **pagina de 50 em 50** e o paginador é uma **linha da própria tabela** | 22 tabelas paravam na página 1 e o resultado parecia íntegro: **2.020 linhas** contra as 21.955 reais |
| 3 | Linha de paginador descartada por **conteúdo** ("células todas numéricas") | apagou **todas** as linhas da `Tabela de Limite de entrega`, cujos dados são quatro colunas de datas em dígitos. Hoje o descarte é pela **marcação** (`<tr>` que contém `Page$`) |

Mais duas descobertas do mecanismo: o total **não pode ser lido do paginador** (ele mostra só uma
janela `… 4 5 6 …`; ler dali dava 11 páginas para a tabela de Municípios, que tem **112**), e
**`Page$Next` o servidor recusa** — só índice numérico funciona. O fim se descobre por exaustão:
pede 2, 3, 4… até o servidor recusar ou a página não trazer nada novo.

O arquivo grava `recusadas` e um `completa` por tabela. **Truncamento é registro, nunca silêncio** —
um código que existe na página 12 e não no nosso dump vira "código inválido" na escrituração, ou,
pior, vira outro código.

**Duas recusas na colheita atual, ambas legítimas:** uma tabela sem nome cujo próprio servidor
responde "A versão da tabela 211 não possui estrutura", e `Informativos ao Contribuinte`, que não é
tabela de dados.

## Estado da Entrega 8

**Entregue:** o rastro (upload do arquivo, marca de transmissão no PVA, recibo); a **regra de
obrigatoriedade** com as três respostas — optante do Simples não entrega, e a tela cita a norma
(`features/obrigacoes/entregas/lib/obrigatoriedadeEfd.js`); e o **passo zero completo** — Guia,
as duas NTs de 2026 e as tabelas.

**Não entregue: o gerador do arquivo.** Os insumos agora existem; o que falta é o trabalho de
escrever registro a registro contra o Guia — e, sobretudo, o **critério de aceite nº 1: importar e
validar no PVA sem erros**. Esse gate **não é executável neste ambiente** (o PVA é programa desktop
com assinatura por certificado) e precisa do contador rodando o validador. Gerador escrito contra o
Guia e nunca passado pelo PVA é exatamente o risco que a especificação nomeia: *arquivo aceito com
dado errado é o pior*.

## Reconferência da Resolução CGSN 140/2018

O corpo da resolução resiste a extração automatizada; os **anexos** são baixáveis pela rota
`anexoOutros.action` do portal — ver `docs/fontes-fiscais.md` §1.12 e §1.13, que é quem depende
dessas transcrições. Os Anexos VI e VII (mapeamento CNAE) fecham o parâmetro "CNAE → anexo" do
FONTES_FISCAIS §9 e ainda não foram carregados.
