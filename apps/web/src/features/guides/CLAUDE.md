# CLAUDE.md — Guias (apps/web/src/features/guides)

Feature de guias no frontend: listagem por empresa, upload/identificação, captura,
envio em lote e o painel de guias esperadas.

## Subpastas

- `list/` — tabela de guias da empresa (`renderCompanyGuidesTable.jsx`), com o
  **`MarcarVazioDropdown`** na barra de ações: as guias **esperadas** do mês (por regime/prolabore,
  via `GET /firm/companies/:id/guides/expected`) viram as opções do menu, e marcar chama
  `markGuideVazio`/`undoGuideVazio`.
  - ⚠⚠ **ESTE ITEM DESCREVIA UM `ExpectedGuidesPanel` QUE NÃO EXISTE MAIS.** Medido em 28/08/2026:
    não há arquivo com esse nome em `apps/web/src` — sobraram duas menções em documentação e uma em
    comentário. Ele era um painel PRÓPRIO, no topo da tabela, com as esperadas em três cores
    (presente verde · vazio âmbar · faltando vermelho).
  - ⚠ **A CAPACIDADE NÃO SE PERDEU, mudou de forma:** a rota continua existindo e sendo chamada, e
    quem responde "o que falta neste mês" na TELA passou a ser o chip de guia do dashboard e a
    matriz do envio em lote. O que o menu herdou foi o ATO (marcar vazio), não o painel.
- `capture/` — modal de captura SERPRO. `batch-email/` — envio em lote (**5 estados** por célula:
  ausente ✗ / ⊘ vazio / 📄 guia / **✖ falhou** / ✓ enviado).
  ⚠ **`✖ falhou` é o estado que faltava.** A célula pintava PENDING, ERROR e `null` tudo como
  "📄 guia": na única tela em que o contador decide o que enviar, a tentativa que FALHOU tinha a
  mesma cara da que nunca foi feita — e nada tenta de novo sozinho (Q55). O `emailStatus` já vinha
  no payload e era descartado no render. Agora vem com **`falhou` + `emailLastError` +
  `emailAttempts`**, o motivo fica no `title`, e uma **faixa no topo** conta as falhas e seleciona
  só elas num clique (varrer 30 linhas × 8 colunas com os olhos não é aviso). A linha **continua
  selecionável**: o envio manual alcança `ERROR`, então a mudança é de exibição, não de
  elegibilidade.

## ⚠ POR QUE NÃO HÁ GUIA NESTE MÊS — `list/lib/estadoVazioGuias.js`

O vazio da tabela era **uma frase só** — *"Nenhuma guia encontrada para os filtros atuais."* — para
situações que exigem ações **opostas**. E a pior delas não era ambiguidade: era a **falha de carga**
se parecendo com ausência, fazendo o contador concluir que não há tributo a pagar naquele mês.

Seis respostas, regra pura com 16 testes + a ligação em `components/__tests__/estadoVazioNaTela.test.jsx`:

| chave | quando | o próximo passo |
|---|---|---|
| `FALHA` | o servidor não respondeu / recusou (`lib/falhaDeCarga.js`) | nenhum — e a frase **diz** que não se sabe se deveria haver guia |
| `TODAS_COMPETENCIAS` | "Ver todas as competências" ligado | não há mês único sobre o qual perguntar |
| `SEM_MOVIMENTO` | `CompanyMonthlyCircular.semFaturamento === true` | nenhum — o DAS não é exigido |
| `NAO_APURADO` | `ApuracaoSnapshot.estado` ∈ aberta/pendente/configurando | **Ir para Apuração** |
| `APURADO_SEM_GUIA` | estado ∈ calculada/revisada/fechada/transmitida/confirmada | **+ Subir guia** |
| `INDEFINIDO` | qualquer outro estado, ou nenhum | manda conferir antes de concluir |

- ⚠ **São TRÊS perguntas diferentes, e por isso duas chamadas + uma que NÃO entra.**
  `getFechamento` responde o estado da APURAÇÃO; `getFechamentoContabil` responde `semFaturamento`.
  `monthClosed` (fechamento **contábil**) é a terceira e **fica de fora**: mês fechado no razão não
  diz nada sobre haver guia a pagar. Era esse o dado que a aba já tinha — e ele não respondia a
  pergunta.
- ⚠ **Só consulta quando há vazio a explicar** (`precisaExplicarVazio`). Competência com guia não
  paga chamada nenhuma; há teste provando que nada sai.
- ⚠ **Estado desconhecido NÃO vira "não apurado"** — vira `INDEFINIDO`. As listas são **fechadas**,
  pelo mesmo motivo de `COLUNAS_CONHECIDAS` no SITFIS: enum novo não pode ser concluído por
  semelhança. Mesma disciplina de `chaveSituacaoFiscal`, onde valor estranho cai em `NAO_CONSULTADA`.
- ⚠ **`semFaturamento` exige `=== true`.** O campo é **tri-estado** no banco: `null` é "ninguém
  disse nada", não "não teve receita".
- ⚠ **Nenhuma das seis respostas afirma que a empresa está em dia** — há teste varrendo
  `em dia|regular|nada consta|tudo certo` nos textos.
- `onIrParaApuracao` é prop; sem ela o texto continua, só o atalho some. A aba de Apuração é
  **`cadastroFiscal`** (`apuracao-v2` saiu do menu e virou sub-aba interna).

## ⚠ `PARCELAMENTO` é um tipo do menu "+ Subir Guia" — e a guia é ANEXO, não gatilho (R4)

`list/components/GuiaDeParcelamentoModal.jsx`, com as regras em `lib/anexoParcelamento.js`
(23 testes) e a ligação em `list/components/__tests__/renderCompanyGuidesTable.test.jsx`.

O contrato **já existe** (nasce no wizard da aba Parcelamentos, sem documento nenhum). Este modal
põe o **parcelamento no primeiro campo**, deriva o vínculo do cronograma
(*"Será vinculada à parcela {n} de {total} — alterar"*) e pré-preenche competência, vencimento e
valor **pelo contrato**. `＋ Criar novo…` leva à aba Parcelamentos com o wizard já aberto.

⚠ **ANEXAR É SÓ ANEXAR.** O caminho antigo, ao anexar uma parcela a um parcelamento existente,
chamava `onConfirmGuidePayment` logo em seguida — dentro de um `try {} catch {}` **mudo**. Anexar o
documento CONFIRMAVA o pagamento dele, e quando a confirmação falhava (mês fechado, por exemplo)
nada na UI dizia. Confirmar pagamento continua sendo o botão da barra de ações; a baixa contábil
continua sendo ato deliberado na aba Parcelamento.

⚠ **O TIPO DA GUIA DEIXOU DE SER FORÇADO A `"SIMPLES"`.** Os dois caminhos do modal antigo faziam
`handleStartUpload("SIMPLES", true)` — inclusive ao anexar parcela de **INSS**, que ficava gravada
com o tipo do DAS do mês. Hoje `tipoGuiaSugerido(modalidade)` **sugere** (INSS → `INSS`;
PARCSN/PERT_SN/RELP_SN/PARCMEI/PERT_MEI/RELP_MEI → `SIMPLES`, que é como
`CaptureSerproParcelaService` grava a parcela do SERPRO; o resto → `OUTRA`) e o select fica à vista
para o contador discordar. Não é tabela de-para fixa: é sugestão.

⚠ **DUPLICIDADE AVISA, NUNCA RECUSA.** Reemissão é legítima (guia vencida, recalculada com juros
novos). `avisosDeDuplicidade` faz duas leituras — a prestação já tem guia · já existe guia do mesmo
contrato naquela competência — e o salvar pede **confirmação explícita** repetindo os avisos.

⚠ **O PDF É OBRIGATÓRIO AQUI, e não por escolha de tela.**
`POST /firm/companies/:id/guides/upload` é a **única** porta de criação de guia no backend e recusa
sem arquivo (`file_required`); não existe rota de guia sem PDF. O que é opcional é a **guia** — o
contrato vive sem ela (débito automático não emite nenhuma) — e o motivo está escrito na tela, não
escondido numa validação.

⚠ **O denominador do "de quantas?" é `parcelasTotal`, o mesmo do card** — não `numParcelas`. Os dois
coincidem em produção (`sincronizarParcelas` materializa `numParcelas` linhas); duas respostas para
a mesma pergunta no mesmo fluxo é o defeito.

### O que saiu junto (R1)

- **checkbox "Esta guia é de parcelamento"** (`capture/components/renderGuideCaptureModal.jsx`) — era
  o gatilho do modal-surpresa que abria DEPOIS de salvar e podia criar um contrato de 60 meses como
  efeito colateral de um upload;
- **item "Parcelamento…"** do menu (âmbar, fora da lista de tipos) e o modal de 3 opções;
- **a heurística de fallback por tipo** em `handleCompleteSave`, que abria o vínculo de parcelamento
  para toda guia `SIMPLES|INSS|DARF|PIS|COFINS|IRPJ|CSLL|ISS` — ou seja, praticamente toda guia do
  sistema — sem ninguém ter dito que aquilo era parcela.

## ⚠ Como uma guia se chama na tela — `lib/rotuloGuia.js`, e só ele

O nome da guia **não sai do `tipo`**: a parcela de parcelamento é `tipo:"SIMPLES"` igual ao DAS do
mês, e a DARF do LP é `tipo:"OUTRA"`. A regra morava **inline no JSX** de `renderCompanyGuidesTable`,
então toda listagem que não repetisse aquela expressão mostrava a parcela como se fosse o DAS.

`rotuloTipoGuia(guide)` / `tituloTipoGuia(guide)` / `ehGuiaDeParcelamento(guide)` (espelho de
`isGuiaDeParcelamento` do backend). Usados pela **aba Guias** (a caixa "Ver todas as competências" é
filtro da mesma tabela) e pela página de **guias pendentes**. Listagem nova usa o helper.

Formato: **`PARC SN Nº 1234567 · 3/10`** — modalidade · número do parcelamento · parcela atual/total.

### ⚠ A modalidade COLAPSA em duas famílias — e o de-para é NÃO DESTRUTIVO

O de-para **não mora aqui**: é `resolverModalidadeParcelamento`, em **`src/lib/vocabulario.js`**, a
camada onde o projeto já traduz enum do banco para palavra do contador. `rotuloGuia` só a consome.

| entrada | rótulo | colapsa? |
|---|---|---|
| `PARCSN` · `PARCSN_ESPECIAL` · `PERT_SN` · `RELP_SN` | **PARC SN** | sim |
| `PARCMEI` · `PARCMEI_ESPECIAL` · `PERT_MEI` · `RELP_MEI` | **PARC MEI** | sim |
| `INSS` · `OUTRO` | o próprio valor | **não** |
| qualquer outra | o valor cru **+ `⚠`** | **não** — levanta revisão |
| ausente | `Parcelamento` | — |

- ⚠ **São DUAS famílias, não uma.** `TIPOS_PARCELAMENTO` (`contracts.js`) tem **dez** valores: os 8
  oficiais (4 SN + 4 MEI) mais `INSS` e `OUTRO`.
- ⚠ **`INSS` NUNCA vira "PARC SN".** É parcelamento previdenciário; colapsá-lo seria trocar um erro
  por outro — o mesmo erro que este arquivo existe para evitar.
- ⚠ **Modalidade nova NÃO colapsa por palpite**: aparece crua com `⚠`, seguindo o precedente de
  `classificarDocumentoArrecadado.js` (código de receita desconhecido levanta alerta e **se recusa a
  classificar**). O catálogo do SERPRO evolui.
- ⚠ **AUSÊNCIA de modalidade não levanta revisão** (parcelamento do caminho V1 não grava `tipo`):
  alerta que acende sempre é alerta que ninguém lê.
- ⚠ **O CRU CONTINUA CHEGANDO À TELA.** Nada foi reescrito no banco e **nenhum campo novo** foi
  criado — a modalidade sempre esteve em `Parcelamento.tipo` e viaja como `guide.parcelamentoTipo`.
  `tituloTipoGuia` põe `Modalidade (SERPRO): RELP_SN` no `title` da linha: PERT e RELP têm reduções
  de multa e juros que a família não distingue, e *"veio como RELP_SN"* precisa ser recuperável numa
  auditoria.
- A lista das 8 é **fechada** (nada de prefixo `^PARCSN`) — é ela que separa "conhecida" de "nova".
  `tipoGuiaSugerido` (`lib/anexoParcelamento.js`) passou a **consumir** o mesmo de-para em vez de
  repetir o regex das 8 modalidades.
- ⚠ **Nada é deduzido do `tipo` da guia.** O fallback antigo era `parcelamentoTipo || tipo`: com a
  modalidade nula (parcelamento criado pelo caminho V1, que não grava `tipo`) ele imprimia
  literalmente **"Parc. SIMPLES"** — o nome do DAS do mês, o oposto do que se queria. Modalidade
  desconhecida vira **"Parcelamento"**, o mesmo genérico do chip do dashboard (uma parcela de INSS
  parcelado também cai aqui).
- Cada pedaço só aparece com o dado presente. Total ausente **não** vira `3/?`.
- Depende de `parcelamentoTipo` / `parcelamentoNumero` / `quantidadeParcelas` no contrato — se o
  rótulo voltar a degradar, o suspeito nº 1 é a relação `parcelamento` não estar no `include`.

## ⚠ A barra de ações também decide pelo VÍNCULO — não só o rótulo

O rótulo não foi o único lugar que lia o `tipo`. A barra "Ações da guia selecionada"
(`list/renderCompanyGuidesTable.jsx`) escolhia o **Recalcular** por `tipo === "SIMPLES"`, então a
PARCELA ganhava o botão que dispara o **PGDAS-D do mês**. E **o backend não recusa**:
`canGuideRecalculate` (`api/.../GuidePaymentStatusService.js`) só olha `source`/`tipo`/pago, e a
parcela é SERPRO + SIMPLES + OPEN. O clique era destrutivo, não um erro tratado:

1. `POST /guides/:id/recalculate` emite o DAS do mês (chamada **PAGA**) passando o id da PARCELA
   como `existingGuideId`;
2. `createOrUpdateGuideFromProcessing` faz **UPDATE nessa linha** — valor, vencimento, PDF,
   `sourceFileId`, `hash`, `extracted`. `parcelamentoId` não está no update e **sobrevive**: a linha
   segue se chamando "PARCSN Nº X · 3/10" com o DAS do mês dentro;
3. `capturePgdasGuideForCompany` termina com um `deleteMany` das outras guias SIMPLES/SERPRO da
   competência — **filtrando por `tipo`, sem `parcelamentoId`**: o DAS de verdade vai junto;
4. a rota chama o worker de e-mail e **manda o PDF trocado ao cliente**.

Hoje a parcela mantém o botão **visível e desabilitado**, com o motivo no `title` — mesmo
tratamento que o INSS já pago recebe. **Sumir seria pior:** a parcela senta na mesma tabela que o
DAS, com o mesmo `tipo`, e sem explicação a saída natural é selecionar a linha de cima.

⚠ **Não há ação de "recalcular parcela" para onde rotear.** A única emissão de parcela é
`capturarParcelaGuideForCompany` → `emitirDasParcela`, e ela **pula parcela já capturada**
(`jaExiste`). Ligar o botão ali exigiria mudar essa idempotência + uma chamada SERPRO nova.

**Confirmar pagamento** e **Liberar ao cliente** NÃO têm o problema, e o motivo é o mesmo nos dois:
agem sobre ESTA guia sem reemitir nada — um marca `paymentStatus=PAID` (o lançamento da parcela
vive na aba Parcelamento), o outro envia o PDF desta linha, que numa parcela é o DAS da parcela.

Ligação coberta em `list/components/__tests__/renderCompanyGuidesTable.test.jsx` (8 testes).

## Padrões

- A lista de guias e ações chegam por props (hooks/pages). ⚠ O `MarcarVazioDropdown` é
  auto-contido e usa `expectedGuidesApi` direto — herdou isso do `ExpectedGuidesPanel`, que **não
  existe mais** (ver a seção de subpastas).
- `tipo="SIMPLES"` é a guia do DAS; a UI rotula como "DAS". `status="VAZIO"` = ausência
  confirmada (amarelo) — não é guia com PDF.
- **Lucro Presumido = 1 DARF consolidada `tipo="OUTRA"`** (não pode ser split). `tipoGuiaLabel`
  (`list/renderCompanyGuidesTable.jsx`) troca "OUTRA" pelos impostos contidos ("PIS · COFINS"),
  lendo `guide.extracted.composicao` — que **o backend precisa enviar** (`toGuideResponse`).
  Se voltar a aparecer "OUTRA" na tela, o suspeito nº 1 é a composição não estar vindo na resposta.
- ⚠ **A coluna PARC do envio em lote carrega DOIS conteúdos** e só um é enviável: a **guia da
  parcela** (SERPRO/V2 — tem PDF, precisa entrar no envio) e a **linha leve de rastreio do V1**
  (`isParcelamento`, sem documento, só informa). Por isso o "info-only" é do **valor da célula**, não
  da coluna: enquanto era da coluna, empresa cuja única pendência do mês era a parcela sumia do
  filtro "só pendentes" e ninguém conseguia selecioná-la.
- Cores de estado: verde `#69FF47`, amarelo `#FFB347`, vermelho `#FF5757` — ⚠ **pelo token**
  (`var(--state-ok|warn|danger)`), nunca pelo hex. Em `renderCompanyGuidesTable.jsx` o `#6272A4`
  usado como cor de TEXTO era **3,02:1** sobre `--bg-subtle` (reprova o mínimo de 4,5:1 do WCAG AA,
  medição em `styles/tokens.css`); virou `var(--text-faint)` (4,82:1). ⚠ A cópia canônica
  `accounting/.../accountingEntriesShared.js` ainda carrega `muted: "#6272A4"` — o conserto do token
  não chegou às cópias.
- Toda chamada nova precisa de par mock/real em `src/api/`.

## LINHA DIGITÁVEL na linha da guia (18/08/2026)

Coluna **"Linha digitável"** em `list/components/renderCompanyGuidesTable.jsx`
(`CelulaLinhaDigitavel`), alimentada por `lib/linhaDigitavelTela.js` (regra pura, com teste próprio).
A **ligação** é prendida à parte, em `list/components/__tests__/linhaDigitavelNaTela.test.jsx` —
regra certa sem chamador não desenha nada.

⚠⚠ **A AUSÊNCIA É RESPOSTA E TEM TRÊS SIGNIFICADOS, com desenhos DIFERENTES:**

| situação | na tela | tom |
|---|---|---|
| `DISPONIVEL` | a linha com máscara + botão de copiar | `--text-muted` |
| `NAO_TENTADA` | "não lida" — ninguém olhou o documento ainda | `--text-muted` |
| `NAO_ENCONTRADA` | "sem linha no documento" — olhamos e não havia | `--text-muted` |
| `DIVERGENTE` | "confira: valores divergentes", **com os dois valores no `title`** | `--state-warn` |

⚠ **Na divergência a linha NÃO aparece** — ela é internamente íntegra mas discorda do valor da guia,
e não se sabe qual dos dois está errado. Mostrar o número seria oferecer como meio de pagamento algo
que não se conferiu; **omitir o conflito seria pior**. Aparece o conflito, com os dois valores.

⚠ **Âmbar, nunca vermelho** (vermelho aqui é o que BLOQUEIA o fechamento, e linha que não bate não
bloqueia nada) e **nunca verde** (verde é concluído; ter o número não é etapa concluída).

⚠ **A máscara é para o olho; o botão copia os 48 DÍGITOS LIMPOS** — é o que se digita no banco.

⚠ **`BotaoCopiar` MUDOU DE CASA**: era local de `companies/list/components/renderCompaniesTable.jsx`
e hoje é `components/ui/BotaoCopiar.jsx`, usado pelo CNPJ e pela linha digitável. Uma segunda cópia
do bloco seria uma segunda implementação da promessa "não mente", e a que ninguém testasse acabaria
mentindo. Sem `navigator.clipboard` (http:// em rede local) ele diz **"não deu"**, nunca "✓" —
travado em `companies/list/components/__tests__/tabelaEmpresasLeitura.test.jsx`.

⚠ **Motivo não catalogado não ganha frase inventada** (`frasePorMotivo` devolve `null`): vira texto
neutro e o valor cru sobrevive no `title`, para a auditoria recuperar. Enum novo não se conclui por
semelhança — mesma disciplina de `list/lib/estadoVazioGuias.js`.

> O portal do **cliente** tem a sua própria leitura (`apps/portal-cliente-web/src/features/guias/lib/`)
> e ela é **deliberadamente diferente numa coisa**: o cliente NÃO vê os dois valores da divergência —
> isso é material de trabalho do contador. Ele vê "em conferência com o contador" e que o PDF
> continua servindo para pagar.


## ⚠ O CANAL DE ENVIO (WhatsApp — Entrega 2, 02/09/2026)

"Liberar ao cliente" e o envio em lote passaram a **respeitar `canalPadraoEnvio`** da empresa
(`EMAIL · WHATSAPP · PERGUNTAR` — o vocabulário é o de `ContatoWhatsappService.CANAL_PADRAO`; o
plano dizia `AMBOS` e o código venceu). A regra é pura em `lib/canalDeEnvio.js`
(`decidirCanaisAoLiberar`, `resumirDesfechoDosCanais`, `ofertaDeRetentativa`, `agruparPrevia`,
`conferenciaDaPrevia`, `podeAbrirLoteWhatsapp`) e a ligação em `lib/liberarComCanais.js` — as duas
com teste, e o `handleLiberarGuia` do workspace só chama.

- ⚠ **A PRÉVIA VEM ANTES DO LOTE, sempre.** `POST /guides/whatsapp/lote/previa` agrupa por motivo
  (`elegibilidadeEnvioGuia.MOTIVOS`, rotulado em `ROTULO_MOTIVO`) e o `lote` só vai com a
  `conferencia` que a rota exige — sem prévia não há POST (teste em `batch-email/`).
- ⚠ **"Tentar de novo por WhatsApp"** só habilita com `envioPodeTentarDeNovo === true`; `null` é
  "a Meta não diz se reenviar resolve — decida", **nunca vira `false`**. O chip lê `envioStatus`,
  `envioErroCodigo` e `envioPodeTentarDeNovo` do `guideCompliance`.
- ⚠ **O desfecho por canal aparece separado** — "WhatsApp: 1 de 1 enviada · e-mail: 2 de 2"; falha
  de um canal não entra na caixa verde do outro.
- **Contatos**: `companies/credentials/lib/contatoWhatsappTela.js` espelha `normalizarE164` da api
  (amarrado por teste que importa a função da api). Nono dígito divergente é *"conserte o
  cadastro"*, nunca tolerância.
- **A página WhatsApp** (`features/whatsapp/`, rota `/whatsapp`, menu da gaveta) tem regra em
  `lib/conversasTela.js`: a janela de 24h é dita **antes** de digitar; a fila (número sem cadastro)
  vem primeiro em âmbar porque é pendência; quem escreveu cada balão (cliente · assistente (IA) ·
  escritório · mensagem fixa) sai do `autor`.
- ⚠ O mock tem **quatro** fios (com a IA + pendência aberta · assumido com janela EXPIRADA · não
  vinculado · **um segundo fio da MESMA empresa, com mensagem de mídia**) e três contatos (um sem
  opt-in) — cada ramo é alcançável offline.

### ⚠⚠ QUEM está falando E de QUAL empresa (06/09/2026)

> Dono: *"inclua um identificador da empresa, além do nome da pessoa precisamos saber de qual empresa
> ela é, isso quando estivermos no chat geral"*.

A linha da lista fazia `c.empresa?.razao || c.nomePerfilProvedor || c.telefoneMascarado` — um `||`
escolhendo entre coisas que **não se substituem**. Numa conversa de cliente aparecia a **empresa** e
o contador **nunca sabia quem estava falando**; numa da fila aparecia a pessoa e não havia empresa.
São duas perguntas — *quem* e *de quem* — e a linha respondia só uma.

Hoje `identidadeDaConversa(c)` (`whatsapp/lib/conversasTela.js`) responde as duas, e a montagem é
**pessoa em cima, empresa embaixo**, na lista **e** no cabeçalho do fio aberto.

- ⚠⚠ **A AUTORIDADE SOBRE O NOME É O CADASTRO** (`contato.nome`), como já é para o vínculo. O
  `nomePerfilProvedor` é o nome que **a própria pessoa** escreveu no aparelho dela — pode ser
  "Financeiro", pode ser qualquer coisa —, e por isso ele nunca casa contato. Aqui ele **exibe** e sai
  **marcado**: `origemDoNome` (`CADASTRO` · `PERFIL` · `TELEFONE`) viaja junto e a tela diz *"nome do
  perfil do WhatsApp, não do cadastro"*.
- ⚠ **O balão de entrada segue a MESMA autoridade.** `rotuloDoAutor` recebia só o nome de perfil: o
  cabeçalho dizia "Financeiro" (cadastro) e o balão logo abaixo dizia "Fin. Empresa 1" (perfil) —
  **duas respostas para "quem escreveu isto", na mesma tela**. Sem nome nenhum ele continua caindo em
  "cliente", nunca no telefone.
- ⚠ **Sem empresa não se inventa:** *"sem empresa — número novo"* em **âmbar**, que já é o estado da
  fila. Linha em branco se lê como "não tem nada a dizer".
- ⚠ **`descricaoDaMidia(m)`** troca `[image]` por *"📎 imagem — este sistema ainda não baixa arquivos
  do WhatsApp"*. A lista de tipos é **FECHADA**: tipo que a Meta inventar amanhã aparece **como veio**
  (*"mensagem de tipo X — não sei exibir"*), nunca vira o nome do vizinho mais parecido.
- ⚠⚠ **`frasePaginacao(temMais)` tem TRÊS respostas, e a terceira é "não sei"**: `true` avisa que há
  mensagens mais antigas, `false` cala, e **ausente** (servidor antigo) vira *"não dá para afirmar que
  esta é a conversa inteira"* — nunca "não há mais".

⚠ **O FIO SAIU DA PÁGINA** para `whatsapp/components/FioDaConversa.jsx`, porque ganhou um **segundo
consumidor concreto**: a mesma conversa dentro da empresa, ao lado das Anotações. `LinhaConversa` e
`FormVincular` **ficaram** — lá dentro a empresa é a mesma em toda linha (seria ruído) e o vínculo não
existe (`portalClientId` nunca é nulo ali). Por isso o vínculo entra por **`slotVincular`**: quem tem
a fila passa o formulário, a aba da empresa não passa nada — em vez de uma prop que desliga metade do
componente.

**Experimentos executados:** devolver a identidade ao `||` de hoje ⇒ **1 vermelho**; `origemDoNome`
sempre `CADASTRO` ⇒ **2**; tirar a linha da empresa da lista ⇒ **2**; desligar o aviso de paginação e
a frase da mídia ⇒ **3**.

## ⚠⚠ A CONFIGURAÇÃO DE ENVIO MORA AQUI (05/09/2026)

> Dono: *"a tela de configuração de envio dentro de guias, lá deve ser o cadastro de emails e
> telefones para envio, e não em senha e acesso"*.

Gaveta (`Modal`) aberta pelo botão **"Configuração de envio"** no topo da aba Guias
(`renderCompanyDetailPage.jsx` → `ConfiguracaoDeEnvioWrapper`). É a MESMA lista e o MESMO hook que
viviam na aba de credenciais — o que mudou foi o LUGAR: aquela aba guarda **segredo e acesso**, e
quem recebe a guia é assunto do **envio**.

- **O destinatário tem os dois canais.** Telefone deixou de ser obrigatório; **um dos dois basta**
  (espelho de `salvarContato`). A linha nomeia a ausência — *"sem WhatsApp"*, *"sem e-mail"* —
  porque campo que some se lê como defeito.
- ⚠⚠ **O OPT-IN VALE SÓ PARA O WHATSAPP.** `situacaoDoContato` ganhou o quarto estado `SO_EMAIL`
  (*"recebe por e-mail · sem opt-in para WhatsApp"*), em tinta **neutra**. Antes dele, o
  destinatário só de e-mail saía como *"não recebe até registrar a autorização"* — **falso**, e
  mandava o contador atrás de uma autorização que o e-mail não exige. ⚠ Defeito visto no NAVEGADOR,
  não no teste: o mock exigia telefone, então esse destinatário era **inalcançável offline**.
- ⚠ **O `+55` não se digita.** `normalizarE164` já o prefixava desde agosto; o rótulo é que pedia o
  `+`. Ele continua aceito — é o único desambiguador de DDI para número estrangeiro.
- ⚠ **O terceiro e-mail saiu do cadastro da empresa** (ficaram o da empresa e o de acesso). A coluna
  `guideNotificationEmail` **não foi apagada** e o valor salvo continua viajando no formulário —
  ⚠⚠ mas ela **deixou de ser a rede**: no mesmo dia o dono tirou a cascata do caminho da guia
  (*"fora isso não sai e mostra por que não foi"*). O que salvou a carteira foi o **backfill**, não
  a cascata.
- ⚠⚠ **UM CANAL BASTA.** Empresa que só tem WhatsApp não tem e-mail para falhar:
  `resumirDesfechoDosCanais` diz *"sem e-mail cadastrado · WhatsApp enviado"* em **verde**. Ele
  separa **entregou?** de **algo falhou?** — canal ausente não é canal que falhou. ⚠ Nenhum canal
  ⇒ vermelho, com o lugar do conserto na frase.

### Reenviar guia já enviada

`GUIA_JA_ENVIADA` deixou de ser o fim do caminho (`liberarComCanais` + `perguntaDeReenvio`): a tela
**avisa com o motivo que o servidor deu** e, só com o sim, repete o pedido com `reenviar: true`.
⚠ **Vale no envio POR GUIA.** O lote continua pulando as já enviadas — é o que impede a carteira
inteira de sair duas vezes num clique.
