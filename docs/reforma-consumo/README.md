# Reforma tributária do consumo — artefatos oficiais versionados

Mesma regra de `docs/lc116/`, `docs/irpf/`, `docs/lista-servico-nacional/` e
`docs/leiaute-nfse/`: **tabela e alíquota não se transcrevem de memória nem se deduzem por
analogia**. O texto oficial entra no repositório com URL, data e hash, e o código é **gerado** a
partir dele por um script que **aborta** na divergência.

⚠⚠ Este diretório nasceu em **01/09/2026**, quando a entrega do IBS/CBS no planejamento tributário
foi preparada. Ele existe porque a pesquisa **contradisse o plano em quatro pontos** — ver "O que a
fonte corrigiu", abaixo. Nenhum deles teria aparecido sem ler a lei.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `lcp214.htm` | `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm` | 2026-09-01 |
| `lcp227.htm` | `https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm` | 2026-09-01 |

```
lcp214.htm  5.402.213 bytes  SHA-256 6f3e19fefd0b4e11839c6ea4a9d18dfaec57b6c1025352b8a83c367a9267ad40
lcp227.htm  1.334.008 bytes  SHA-256 13129baaca70829a91da3a127b96af468d95a055d99c7810d480568d528d88be
```

São os **textos compilados** do Planalto: a `lcp214.htm` já traz, no corpo, as marcas
`(Redação dada pela Lei Complementar nº 227, de 2026)` e `(Incluído pela Lei Complementar nº 227,
de 2026)`. **É essa a versão que vale** — ver o § 10 do art. 13 da LC 123, abaixo, onde a redação
original e a atual dizem coisas diferentes e as duas estão impressas lado a lado no arquivo.

⚠ **O Planalto recusa o fetcher HTTP deste agente** (`ECONNRESET`, três tentativas, dois caminhos).
Com `curl -A "Mozilla/5.0"` responde em segundos — é a mesma armadilha que `docs/lc116/README.md`
registra. Quem for rebaixar e achar que o site caiu: é isto.

⚠ Encoding **ISO-8859-1**. Converter com `pdftotext -enc UTF-8` (no PDF) ou lendo como `latin-1`
(no HTML) — ler como UTF-8 devolve texto ilegível e faz a varredura de dispositivo não achar nada.

---

## ⚠⚠ O QUE A FONTE CORRIGIU — quatro erros de um plano escrito sem ela

O plano desta entrega foi redigido a partir de material secundário. A leitura do texto oficial
derrubou quatro afirmações dele. Ficam registradas porque **cada uma mudaria um número na tela**.

### 1 · ⚠⚠ Quem reescreveu os Anexos I a V da LC 123 foi a **LC 214/2025**, não a LC 227/2026

> **LC 214/2025, art. 519:** *"Os Anexos I a V da Lei Complementar nº 123, de 14 de dezembro de
> 2006, passam a vigorar com a redação dos Anexos XVIII a XXII desta Lei Complementar."*

A LC 227/2026 **não toca em Anexo nenhum da LC 123**. Varredura do texto inteiro dela: as únicas
ocorrências de "Anexo" em relação à LC 123 são referências (arts. 18 e 23), nunca substituição. Ela
altera a LC 123 por dois artigos — o **168** (arts. 22, 33, 39 e 41) e o **169** (arts. 18, 18-A,
21, 33 e 38-B) — e mais nada.

### 2 · ⚠⚠ Os Anexos novos só produzem efeitos em **1º/01/2027**

> **LC 214/2025, art. 544, III** (redação da LC 227/2026): *"a partir de 1º de janeiro de 2027, em
> relação aos arts. 168 a 171, 309 a 315, 444, 450 (…) **519** a 534 e 542"*.

O art. 519 é o que reescreve os Anexos. Ou seja: **em 2026 valem os Anexos antigos**, sem coluna de
CBS nem de IBS. Uma tela que mostrasse a partilha nova para uma competência de 2026 estaria
afirmando uma repartição que a lei ainda não pôs em vigor.

⚠ E o art. 169 da LC 227 (as mudanças no art. 18 da LC 123) tem a **mesma** data: art. 182, I, "b".

### 3 · ⚠⚠ Para o optante do Simples, IBS e CBS em 2026 são **ZERO** — e isso é literal

> **LC 214/2025, art. 348, III:** *"as alíquotas do IBS e da CBS previstas nos arts. 343 e 346 desta
> Lei Complementar: (…) **c) não serão aplicadas em relação às operações dos contribuintes optantes
> pelo Simples Nacional**."*

As alíquotas de teste de 2026 — **IBS 0,1%** (art. 343) e **CBS 0,9%** (art. 346) — **não alcançam o
Simples**. Mostrar qualquer outro número para um optante em 2026 é inventar.

⚠ Isto **não** revoga o §1º do art. 348 (a dispensa de recolhimento para quem cumpre as obrigações
acessórias): são coisas diferentes, e a dispensa vale para quem a alíquota alcança.

### 4 · ⚠⚠ A alíquota de referência: quem calcula é o **TCU**, quem fixa é o **SENADO**, e o prazo é outro

O plano dizia *"a RFB tem até 14/09/2026 para propor ao TCU"*. Errado no órgão e na data.

> **Art. 349, § 1º:** *"I - o **Tribunal de Contas da União** enviará ao **Senado Federal** os
> cálculos (…) até o dia **15 de setembro** do ano anterior ao de vigência (…); II - o **Senado
> Federal** fixará as alíquotas de referência e o redutor até o dia **31 de outubro** do ano
> anterior (…)"*
>
> **Art. 353, § 2º:** *"(…) no ano de 2026, os prazos referidos nos incisos I e II do § 1º (…) do
> art. 349, serão **prorrogados em 45 (quarenta e cinco) dias**."*

Com a prorrogação: TCU → Senado até **30/10/2026**; Senado fixa até **15/12/2026**.

⚠⚠ **E daí sai uma simplificação que o plano não tinha:** para 2027–2028 **o IBS é conhecido por
lei** (0,05% estadual + 0,05% municipal, art. 344) e **só a CBS é desconhecida** — porque a alíquota
de referência do IBS só é fixada **para os anos de 2029 a 2033** (art. 349, II). Um cenário 2027 não
precisa de "uma alíquota-padrão digitada": precisa de **um** número digitado, o da CBS.

---

## A conta do crédito "por dentro" — a base legal, literal

> **LC 123/2006, art. 23, § 1º-A** (na redação que a LC 214/2025 lhe deu, com o ajuste da LC
> 227/2026): *"As pessoas jurídicas (…) não optantes pelo Simples Nacional terão direito a crédito
> ao IBS e à CBS incidentes sobre as suas aquisições (…) de microempresa ou empresa de pequeno porte
> optante pelo Simples Nacional, **em montante equivalente ao cobrado por meio desse regime
> único**."*
>
> **§ 2º:** *"A alíquota aplicável ao cálculo do crédito (…) corresponderá aos **percentuais de
> ICMS, IBS e CBS previstos nos Anexos I a V** desta Lei Complementar para a faixa de receita bruta
> a que a microempresa ou a empresa de pequeno porte estiver sujeita no mês de operação."*

É isto que torna o crédito **calculável com exatidão**, sem estimar nada:

```
crédito transferido = alíquota efetiva do Simples × (%CBS + %IBS do Anexo, na faixa)
```

⚠ E o **§ 3º** fecha o caso de início de atividade: ali valem *"os percentuais de ICMS, IBS e CBS
referentes à **menor alíquota** prevista nos Anexos I a V"*.

## A opção "por fora" — prazo, irretratabilidade e a trava de saída

> **LC 214/2025, art. 41, § 3º:** *"Os optantes pelo Simples Nacional poderão exercer a opção de
> apurar e recolher o IBS e a CBS pelo regime regular (…)"* · **§ 4º:** *"(…) será exercida nos
> termos da Lei Complementar nº 123"* · **§ 5º:** *"É vedado ao contribuinte do Simples Nacional
> (…) retirar-se do regime regular do IBS e da CBS caso tenha recebido ressarcimento de créditos
> desses tributos no **ano-calendário corrente ou anterior**"*.

⚠ O plano dizia *"não volta no ano corrente nem no seguinte"*. O texto é **"corrente ou anterior"**
— é sobre quando o ressarcimento foi RECEBIDO, não sobre quanto tempo a trava dura.

> **LC 123/2006, art. 13, § 9º** (incluído pela LC 227/2026): *"É facultado ao optante pelo Simples
> Nacional apurar e recolher o IBS e a CBS de acordo com o regime regular aplicável a esses
> tributos, hipótese em que as parcelas a eles relativas **não serão cobradas pelo regime único**."*
>
> **§ 10** (redação da LC 227/2026): *"A opção (…) será exercida para os semestres iniciados em
> janeiro e julho de cada ano, sendo **irretratável** para cada um desses períodos, devendo ser
> exercida nos meses de **setembro e março** imediatamente anteriores a cada semestre, **na forma
> regulamentada pelo CGSN**."*

⚠⚠ **A redação ORIGINAL da LC 214 dizia "setembro e ABRIL", e os parágrafos eram outros** (§ 10 e
§ 11). Foi a LC 227/2026 que mudou para **março** e renumerou. As duas versões estão impressas lado
a lado no `lcp214.htm`, e ler a errada muda a data que a tela anuncia ao contador.

⚠⚠ **E a opção depende de regulamentação do CGSN** ("na forma regulamentada pelo CGSN"). **Não há,
neste repositório, prova de que essa regulamentação exista.** A tela pode dizer qual é a janela
legal; ela **não pode** afirmar que o procedimento está disponível.

## O que NÃO foi extraído, e por quê

- **As tabelas dos Anexos XVIII a XXII** ainda não viraram dado gerado. São **5 anexos × 7 períodos
  de vigência** (2027-2028 · 2029 · 2030 · 2031 · 2032 · 2033+), ~35 tabelas.
  ⚠ Uma extração por regex sobre o texto convertido **já produziu erro na primeira tentativa**: no
  Anexo III saíram `16,42` e `16,41` para a mesma faixa (são tabelas de vigências diferentes se
  misturando) e um bloco somou **100,01%**. A guarda que pegou isso — *a partilha de cada faixa tem
  de somar exatamente 100%* — é a que o gerador precisa ter, e é ela que decide se o dado entra.
- **As frações de redução de ICMS/ISS de 2029 a 2032** (arts. 501 e 508): fora do escopo desta
  entrega, e sem elas 2029+ não é calculável.
