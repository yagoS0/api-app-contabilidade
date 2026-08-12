# Segregação de receitas no Simples Nacional — o que a Receita exige

Fonte da segregação que o PGDAS-D pede, levantada em documento oficial para o relatório de
faturamento pré-apuração e para a classificação das notas.

> ⚠ **Este arquivo não é opinião nem memória.** Cada regra abaixo cita o item do manual ou o
> artigo. O que **não** foi confirmado em fonte primária está marcado como tal, e não deve virar
> decisão de produto antes de alguém abrir o documento.

## Fontes

| Documento | Onde | Versão lida |
|---|---|---|
| Manual do PGDAS-D e DEFIS (RFB) | `www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/manual_pgdas-d_2018_v4.pdf` | 17/06/2025 (confirmado no item 14 do próprio manual) |
| Perguntas e Respostas do Simples Nacional (Secretaria-Executiva do CGSN) | `www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf` | 21/11/2025 |
| Resolução CGSN nº 140/2018, art. 25 | ⚠ lido em **consolidação de terceiro** (PortalTributário). O `normas.receita.fazenda.gov.br` só devolve página de redirecionamento | — |

---

## Por que este arquivo existe

O dono pediu um relatório de faturamento antes de apurar, tendo como base o relatório
"Faturamento no Período — Consolidado" do Scritta/Nasajon, que separa a receita em
`01 - sem Subst.Tributária` e `02 - PIS/COFINS MF`.

⚠ **Esses dois códigos não existem em nenhuma fonte pública e não são padrão de mercado.** Uma
varredura pela documentação aberta de Domínio, Alterdata, Questor, Sage/IOB, Nasajon, Qive, SIEG,
Tecnospeed e Oobj não os encontrou — nem na própria Nasajon. O que eles são, na prática, é a
abreviação da segregação que a **Receita** exige, e que está transcrita abaixo. Por isso o nosso
relatório usa o vocabulário do manual, não o do Scritta: um é oficial e verificável, o outro é
rótulo de tela de um concorrente.

---

## (A) As 14 linhas de atividade

Manual do PGDAS-D, **item 6.5 "Atividades econômicas com receita no período de apuração", pp. 23-25**.
Abertura literal: *"O contribuinte deverá considerar, destacadamente, para fins de cálculo, as
receitas conforme abaixo"*.

| # | Atividade | Subdivisões |
|---|---|---|
| 1 | Revenda de mercadorias, exceto para o exterior | **Com** / **Sem** ST-monofásico-antecipação (ver abaixo) |
| 2 | Revenda de mercadorias para o exterior | — |
| 3 | Venda de mercadorias industrializadas pelo contribuinte, exceto para o exterior | **Com** / **Sem** |
| 4 | Venda de mercadorias industrializadas pelo contribuinte para o exterior | — |
| 5 | Locação de bens móveis, exceto para o exterior | — |
| 6 | Locação de bens móveis para o exterior | — |
| 7 | Prestação de serviços, exceto para o exterior | 10 sub-opções |
| 8 | Serviços dos subitens 7.02, 7.05 e 16.1 da LC 116/2003, exceto para o exterior | 9 sub-opções |
| 9 | Prestação de serviços para o exterior | 4 sub-opções |
| 10 | Serviços dos subitens 7.02 e 7.05 da LC 116/2003, para o exterior | 2 sub-opções |
| 11 | Comunicação; transporte intermunicipal/interestadual de carga e de passageiros (art. 17, VI, LC 123), exceto para o exterior | 4 sub-opções |
| 12 | Idem, para o exterior | Transporte / Comunicação |
| 13 | Atividades com incidência simultânea de IPI e de ISS, exceto para o exterior | 3 sub-opções |
| 14 | Atividades com incidência simultânea de IPI e de ISS para o exterior | — |

**Os dois rótulos das linhas 1 e 3, literalmente** — são o `01`/`02` do Scritta:

> *Sem substituição tributária/tributação monofásica/antecipação com encerramento de tributação
> (o substituto tributário do ICMS deve utilizar essa opção)*
>
> *Com substituição tributária/tributação monofásica/antecipação com encerramento de tributação
> (o substituído tributário do ICMS deve utilizar essa opção)*

**As 10 sub-opções da linha 7** cruzam três eixos: escritório contábil com ISS fixo · sujeito ao
fator "r" · não sujeito ao fator "r" e Anexo III · Anexo IV — **×** os três estados do ISS
(sem retenção com ISS a outro município · sem retenção com ISS ao próprio município · com
retenção/substituição de ISS).

Base legal: **CGSN 140/2018, art. 25, §1º, I a IX** (I revenda · II industrialização · III Anexo III ·
IV Anexo IV · V fator "r"/Anexo V · VI locação de bens móveis · VII IPI+ISS · VIII escritório
contábil · IX transporte intermunicipal/interestadual e comunicação); **§3º** exportação; **§4º**
conceito de exportação de serviços; **§5º** locação de bens móveis é só a de fora da lista da LC 116.

---

## (B) As 8 qualificações tributárias

Manual, **item 6.6.1 "Qualificações Tributárias", p. 27**. Literal: *"O contribuinte poderá
informar, para cada tributo, se for o caso, as seguintes qualificações"*.

| Qualificação | Tributos | Item |
|---|---|---|
| Antecipação com Encerramento de Tributação | ICMS | 6.6.2 |
| Substituição Tributária | ICMS, PIS, Cofins | 6.6.3 |
| Tributação Monofásica | PIS e Cofins | 6.6.4 |
| Exigibilidade Suspensa | IRPJ, CSLL, PIS, Cofins, ICMS, ISS, IPI, CPP | 6.6.5 |
| Imunidade | ICMS, IPI e ISS | 6.6.6 |
| Isenção/Redução | ICMS e ISS | 6.6.8 / 6.6.9 |
| Isenção/Redução Cesta Básica | ICMS | 6.6.10 / 6.6.11 |
| Lançamento de Ofício | IRPJ, CSLL, PIS, Cofins, ICMS, ISS, IPI, CPP | 6.6.7 |

### A trava de validação que importa para software

Manual, **item 6.5, p. 26**, literal: *"Se assinalado **Com substituição tributária/tributação
monofásica/antecipação com encerramento de tributação**, pelo menos uma das opções abaixo deverá
ser selecionada, para que o aplicativo prossiga"* — e são exatamente **seis**:

`COFINS monofásica` · `COFINS ST` · `PIS monofásica` · `PIS ST` ·
`ICMS antecipação com encerramento` · `ICMS ST`

---

## ⚠ Uma linha de atividade pode ter N parcelas com qualificações diferentes

Mesmo item 6.5, p. 26, literal:

> *Se precisar subdividir o valor da receita COM substituição tributária (parte da receita tem
> substituição de ICMS e a outra parte tem tributação monofásica de PIS e Cofins, hipoteticamente),
> basta clicar no botão '+' na extremidade direita da tela.*

**Isto é estrutural, não detalhe de tela.** Um modelo que assuma *uma atividade = um valor* não
cabe o caso real. Vale para `ApuracaoConfigMemory.atividadesEscolhidas`, para o payload do
`TRANSDECLARACAO11` e para o relatório de faturamento — os três hoje assumem uma linha, um número.

---

## ⚠ Substituto e substituído marcam opções OPOSTAS

**CGSN 140/2018, art. 25, §8º**, confirmado no manual 6.6.3 e em Perguntas e Respostas 7.1:

- o **substituto** tributário do ICMS usa a opção **SEM** substituição tributária;
- o **substituído** usa a opção **COM**.

É o erro clássico desta área, e é invisível: as duas opções existem, as duas aceitam o valor, e a
declaração sai com o imposto errado. Toda regra que derive isto automaticamente precisa do teste
com os dois papéis.

---

## ISS: três informações, não uma

**CGSN 140/2018, art. 25, §9º** — a ME/EPP que prestou serviço sujeito ao ISS deve informar:

1. *a qual Município é devido o imposto*
2. *se houve retenção do imposto*
3. *se o valor é devido em valor fixo diretamente ao Município*

Manual, item 6.6, p. 27: *"Para as atividades de prestação de serviços [...] com ISS devido a
outro(s) Município(s) é necessário selecionar o Município/UF para o qual é destinado o ISS."*

Perguntas e Respostas, item 7.7: segregada a receita já retida, *"quando da apuração do valor
devido do Simples Nacional não será considerado o percentual do ISS no cálculo"*.

---

## Detalhes que costumam quebrar implementação

- **Exportação (art. 25, §3º)** desconsidera os percentuais de **Cofins, PIS/Pasep, IPI, ICMS e
  ISS** — é a única segregação que zera cinco tributos de uma vez.
- **Monofásico (art. 25, §§6º e 7º; manual 6.6.4):** as receitas *"continuam fazendo parte da base
  de cálculo dos demais tributos"*. Só saem os percentuais de PIS e Cofins. Zerar a receita inteira
  é erro.
- **Isenção/Redução (manual 6.6.8/6.6.9):** só valem quando concedidas **especificamente** a
  optantes do Simples. A redução exige **valor da parcela** + **percentual** (mín. 0,01%, máx.
  100,00%), e *"A soma das parcelas de receita com isenção + redução não pode ser superior à receita
  total informada para a atividade"*.
- **Perguntas e Respostas 5.5:** *"Todas as receitas deverão ser informadas no aplicativo de cálculo
  [...] sendo que ele irá efetuar os devidos ajustes"*. Não se omite receita com ICMS/ISS fora do
  Simples — segrega-se.

---

## O que conseguimos derivar da nota HOJE

Medido no código, não estimado.

| Segregação | Temos? | Onde / por quê |
|---|---|---|
| Atividade → anexo | estruturalmente sim, na prática **não** | `NotaItem.tipoReceita` existe e o `ClassificadorService` sabe preenchê-lo; **nulo em 16.153/16.153 itens** — a classificação nunca foi rodada |
| Mercado externo (exportação) | só NF-e, e **nunca disparou** | único escritor é `DfeParser.js` (CFOP 7xxx); `flagExportacao` false em 16.153/16.153. Para NFS-e o mercado só existe em `ApuracaoConfigMemory.mercado` |
| Substituição tributária | **não** | `NotaItem.flagST` **sem nenhum escritor** |
| Monofásico PIS/Cofins | **não** | `NotaItem.flagMonofasico` **sem nenhum escritor** |
| ISS retido na fonte | **não**, para nota capturada | `issRetido` só existe em `ServiceInvoice` (emissão). `PortalInvoice`/`NotaItem` não têm o campo |
| Município do ISS | **não** | nenhum campo |
| Imunidade / isenção / redução | **não** | nenhum campo |
| CFOP | **sim**, para NF-e completa | `NotaItem.cfop`, com índice. A rota já aceita filtrar por ele; a UI não expõe |

⚠ **`NotaItem` não tem CST nem CSOSN**, então ST e monofásico **não são deriváveis nem em
princípio** a partir do que está persistido. O XML sobrevive em `xmlRaw`, mas não é consultável.

---

## De onde a segregação deve sair — e o que o mercado faz

O CFOP sozinho **não decide em lugar nenhum**. Os três ERPs contábeis com documentação técnica
aberta usam uma **entidade intermediária configurável**, cruzada com **NCM/CST/CSOSN no nível do
item**:

| Sistema | Entidade | Rótulo verificado |
|---|---|---|
| Domínio / Thomson Reuters | **Acumulador** | guia Impostos → `44 - SIMPLES NACIONAL` → `Definições` (Anexo, Seção, Tabela). Monofásico por Acumulador/Produto/**NCM**/**CST** |
| Alterdata | cadastro de **CFOP** | seção literal **"Super Simples"** com *"Selecione o tipo de receita"* + Operação (dentro do Estado / do país / **no Exterior**). Por produto: `CST de PIS/COFINS`, `Natureza da Receita` |
| Questor | **Naturezas** | `Configurador de Naturezas` (Receita / Dedução / Exclusão) |

**Conclusão para nós:** a segregação deve vir do **cadastro** (`ProdutoServico`, que já existe),
não de dedução sobre a nota. É o que o mercado inteiro faz, e é o único caminho que não vira dívida
quando passarmos a **emitir** nota — aí o dado nasce na origem em vez de ser adivinhado depois.

⚠ **Posicionamento, medido:** a segregação do Simples apresentada como conferência pré-PGDAS **não
é padrão de mercado**. Nenhum dos quatro especialistas em captura de XML a faz (Qive, SIEG,
Tecnospeed, Oobj), e os que a vendem (e-Auditoria, é-Simples, Sittax) não têm um único rótulo de
tela verificável publicamente. Já o **relatório de notas faltantes por numeração** é a função mais
universal do mercado — **sete** fornecedores, documentada tecnicamente em todos —, e nós não temos
nada disso.

---

## ⚠ Vigência — NÃO CONFIRMADO em fonte primária

A CGSN 140/2018 **não foi revogada**; foi **alterada pela Resolução CGSN nº 190, de 04/08/2026**
(DOU de 10/08/2026), que insere IBS e CBS no Simples e mexe no art. 25 — citam-se um **inciso I-A**
novo e alteração do **inciso X** —, com efeitos majoritariamente a partir de **01/01/2027**.

⚠ **Isto está apenas em fontes secundárias** (atlaspublico, FENACON, CRC-RS). O
`confaz.fazenda.gov.br` foi bloqueado pela política de rede e o inteiro teor não foi localizado no
`in.gov.br`. Uma busca anterior chegou a sugerir *revogação* a partir de 2027, o que se mostrou
**incorreto** ao confrontar com as demais fontes — motivo suficiente para não confiar em nenhuma
delas sozinha. **Abrir o texto oficial antes de qualquer decisão de produto.**

Isto se conecta à decisão já tomada pelo dono sobre a DEFIS (*"deixe a DEFIS então"* /
*"vamos aguardar a real mudança"*): a mesma reforma, o mesmo ano, a mesma necessidade de esperar o
texto oficial em vez de antecipar.
