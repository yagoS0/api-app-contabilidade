# CLAUDE.md — Portal do Cliente na web (apps/portal-cliente-web)

React 19 + Vite, **sem router e sem biblioteca de estado**. Nasceu em 18/08/2026 e recebeu nove
commits em dois dias (`git log --oneline -- apps/portal-cliente-web`). Este documento existe porque
quase toda decisão aqui foi tomada **com a tela na frente do dono**, e a razão dela não cabe no
código que sobrou.

## ⚠⚠ QUEM LÊ ESTA TELA É O CLIENTE, NÃO O CONTADOR

É o critério que decide texto, cor e o que aparece. O contador tem o `apps/web`; aqui quem entra é
o dono da empresa (ou o financeiro dele), que **não edita o próprio cadastro** e não conhece nome de
campo de XML.

**O corte de legendas de 19/08/2026** (commits `98b594e8` e `e2cb154d`) veio disso. O critério, que
está escrito também no cabeçalho de `src/features/emitir/EmitirNotaPage.jsx`:

- **FICA** o texto que (a) muda uma decisão de quem emite, (b) avisa de consequência fiscal, ou
  (c) diz o que fazer quando algo falta.
- **SAI** o que explica a nossa mecânica interna ou nomeia peça de integração. Saíram, nomeados no
  commit: `dCompet`, a dedução de CNAE, a citação da LC 116 art. 3º.

⚠ E o critério literal que o dono deu para a segunda rodada: *"sem sugestão não precisa ser falado,
pois já está sem"* — **sai a frase que descreve uma ausência visível; fica a frase que impede uma
ausência de ser lida como afirmação.** Por isso o `"Não preenchemos: …"` do campo de alíquota vazio
FICOU (`aliquotaEfetiva.js:139`, `textoDaProcedencia`): ele não descreve o vazio, ele impede o vazio
de virar suspeita de defeito. E ficaram os motivos que pedem AÇÃO de quem emite.

⚠⚠ **A FRASE QUE DESCREVE UM COMPORTAMENTO É PARTE DO COMPORTAMENTO.** As duas legendas falsas
achadas em 19/08 (a que ensinava `1500.00` num campo que já não aceitava ponto, e a que dizia que o
não optante "provavelmente seria recusado" depois de o backend passar a ler o cadastro) ficaram
falsas **no dia em que o campo e o backend mudaram** e ninguém tocou no texto. Mudou comportamento:
procure a frase ao lado.

⚠ **Encurtar não é apagar a distinção.** Corta-se palavra, nunca significado — a procedência da
alíquota manteve o aviso de que é a ÚLTIMA competência apurada, e "a emissão é definitiva" ficou
inteiro.

## Estrutura

```
src/
  api/
    index.js            - escolhe mock | real | real_with_mock_fallback  ⚠ ver "O FALLBACK"
    ApiError.js         - status 0 = rede; `code` = recusa nomeada; `corpo` = a resposta inteira
    accountGate.js      - trava de PRODUTO: conta FIRM não entra aqui
    sessionStore.js     - token fora do React (useSyncExternalStore)
    mock/mockApi.js     - modo offline; contrato idêntico ao real
    real/realApi.js     - fetch + refresh; contrato LIDO das rotas, não deduzido
    real/brasilApi.js   - consulta de CNPJ, direto do browser (sem proxy)
  features/
    auth/               - Login, EsqueciSenha, RedefinirSenha
    shell/AppShell.jsx  - casca: empresa ativa, abas, e o estado que atravessa telas
    painel/             - a tela PADRÃO: fluxo de caixa DIÁRIO ⇄ DRE (mockados) + o resumo do mês
                          `PainelDoDia.jsx` - os lançamentos de UM dia; ⚠ só leitura, sem `+`
                          ⚠ era `home/HomePage.jsx` até 21/08/2026 — foi ABSORVIDA, não trocada
    notas/              - lista + DANFSe + cancelamento + "usar como modelo"
    emitir/             - ⚠ a ÚNICA tela deste portal que pratica ato fiscal
                          `lib/impostosDaNota.js`   - quais campos de imposto a nota LEVA (e envia)
                          `lib/tomadoresEmitidos.js`- a memória de tomadores, do lado da TELA
                          `SeletorTomador.jsx`      - a busca "encontra, nunca escolhe"
    lote/               - planilha de emissão em lote: modelo, leitura e CONFERÊNCIA (⚠ NÃO emite)
    guias/              - guias + linha digitável
    fiscal/             - situação fiscal (SITFIS): a tabela que o escritório já salvou
                          ⚠ SÓ LEITURA, e o piso é CLIENT_ADMIN — ver a seção própria
  lib/
    format.js  hooks.js  roles.js  mensagens.js  baixarBlob.js
                    ⚠ `hooks.js` → `useDialogoModal`: Esc, foco que entra, foco PRESO e foco que volta
    municipios/   - SÓ a regra; o dado (5.571 linhas) vem de `@contabilidade/shared/municipios-ibge`
                    por `import()` dinâmico ⚠ a tabela era cópia nos dois portais até 20/08/2026
    servicosNacionais/ - Anexo B gerado (335 códigos, 63 KB), idem
  components/
    ui.jsx           - Chip, Vazio, Carregando, AlertaErro, CardNumero, BotaoCopiar
    icones.jsx       - os SVGs da barra lateral (inline, `aria-hidden`)
    LogoAltan.jsx    - ⚠ a marca, SVG INLINE — ver a seção da marca
  styles/tokens.css  styles/app.css
```

⚠ **Regra de tela vive em `features/<x>/lib/`, com teste próprio**, e a tela só faz a LIGAÇÃO —
mesma disciplina de `apps/web` (`circular/lib/estadoGuia.js` e companhia). Não escreva regra dentro
do `.jsx`.

### Roteamento: hash, 3 destinos, nenhuma dependência

`lib/hooks.js` → `useRota`. `ROTAS = ["home","notas","guias","fiscal"]`, padrão `home`; hash
desconhecido cai no padrão. `App.jsx` despacha por `if`, e a única entrada externa é `/redefinir-senha?token=…`, lida
**uma vez** na carga.

⚠ **A redefinição de senha vem ANTES da sessão** (`App.jsx:44`). Quem clica no link do e-mail pode
ter sessão velha guardada no navegador — inclusive a do invasor de quem está fugindo. Mandá-lo para
o app "porque já está logado" engoliria o link no caso em que ele mais precisa funcionar.

⚠ **"Emitir" NÃO é rota** — foi removida em 19/08/2026 a pedido do dono (virou botão dentro de
Notas). A remoção foi **inteira**: item de menu (`AppShell.jsx:24`), destino (`hooks.js`, `ROTAS`) e
estado. Meia remoção é o "filtro fantasma": `#/emitir` de um link antigo levaria a uma tela sem
saída, porque a aba que servia de saída deixou de existir.

## ⚠⚠ A COMPETÊNCIA É UMA SÓ, E ELA MORA NA CASCA (20/08/2026)

`AppShell` guarda `competencia`; Início, Notas e Guias recebem por prop. Eram **TRÊS**
`useState(competenciaPadrao)` independentes — trocar o mês no Início e ir para Notas voltava ao
padrão, sem nada dizendo que voltou, e o cliente lia meses diferentes em abas diferentes sobre a
MESMA empresa.

⚠ É o defeito que o portal do escritório já pagou e consertou; o cabeçalho de
`apps/web/.../renderCompanyDetailHeader.jsx` o registra como *"o mesmo defeito repetido cinco vezes:
dois seletores para um valor"*. A cura é a mesma: um valor na casca.

- ⚠⚠ **A TERCEIRA CÓPIA (Guias) SÓ APARECEU NO NAVEGADOR.** Unificados Início e Notas, a tela ficou
  com 06/2026 nas duas e 08/2026 em Guias. Meia unificação é o "filtro fantasma" de novo — se
  alguém acrescentar uma quarta tela com mês, ela entra por prop, não por `useState`.
- ⚠ **OS TRÊS CONTROLES CONTINUAM ONDE ESTAVAM**, e isso é decisão: em Notas e Guias ele é um
  FILTRO (com "Todas"), no Início é o RECORTE do resumo. Um controle único na barra do topo
  obrigaria o Início a oferecer um "Todas" que ele não sabe honrar — e controle que não comanda o
  que promete é pior que três. O que passou a ser único é o VALOR.
- ⚠ **"Todas" é conceito de LISTA.** Com ele ligado, o Início cai no mês corrente e **diz qual está
  mostrando** (os rótulos dos cards já nomeavam a competência). O que não pode é o Início somar "o
  período todo" e chamar de mês.
- ⚠ **O default não mudou:** mês CORRENTE (dono, 18/08/2026 — ver `competenciaPadrao`).
- ⚠ **Seletor sem handler fica DESABILITADO, nunca mudo.** O fallback `aoTrocarCompetencia || (() => {})`
  existe para a tela não quebrar com a prop faltando — mas um controle que a pessoa mexe e no qual
  nada acontece é PIOR que o defeito que ele evita (é a família do "filtro fantasma"). Assim, prop
  esquecida vira algo visível na tela em vez de silêncio.
- ⚠ **Trocar de empresa NÃO zera a competência** (o modelo de emissão e o lote, sim). Mês é do
  calendário, não da empresa — mas é decisão, não descuido.
- Travado em `features/shell/__tests__/competenciaAtravessaAsAbas.ligacao.test.jsx` (5 casos).
  ⚠ É teste de LIGAÇÃO porque não há regra nenhuma aqui: as três telas sempre souberam ler uma
  competência, e um teste de unidade de qualquer uma continuaria verde com o defeito de pé.
  ⚠ O helper de navegação precisa flushar uma **tarefa** (`setTimeout(0)` dentro do `act`), não só
  microtarefas: o `useRota` escuta `hashchange`, e o jsdom entrega esse evento numa tarefa.

## ⚠ AS ABAS SÃO `<a href>` (20/08/2026)

O roteamento já é por hash, então `href="#/notas"` sai de graça — e com ele Ctrl/Cmd+clique em nova
guia, clique do meio, "abrir em nova aba", URL no hover e "copiar endereço do link". Um `onClick`
olhando `event.ctrlKey` resolveria o primeiro caso e quebraria os outros quatro. Mesmo movimento que
o escritório fez em 19/08.

- ⚠ **O clique NORMAL continua SPA** (`preventDefault()` + `irPara`): sem isso o `emissaoAberta` se
  perde — é estado da casca e o hash não o carrega, então voltar para Notas cairia num formulário
  meio preenchido em vez da lista. Modificado ou botão ≠ esquerdo passam **sem** `preventDefault`.
- ⚠ E num Ctrl+clique o `irPara` **também não roda**: a guia atual fica onde está, e fechar a
  emissão aqui jogaria fora o formulário de quem só queria abrir Notas do lado.
- ⚠ **O botão "Emitir nota" continua `<button>`** — abre um MODO, não uma rota.
- ⚠ Os testes navegam por `getByRole("link", …)`, e o helper precisa flushar uma **tarefa**
  (`setTimeout(0)` dentro do `act`), não só microtarefas — o `hashchange` do jsdom vem numa tarefa.
  Sem isso a rota trocava DEPOIS da asserção e a suíte ficava vermelha sob carga.
- ⚠⚠ **O jsdom NÃO implementa "Ctrl+clique abre em outra guia"** — para ele o modificador não muda
  nada e a navegação de fragmento acontece igual. Por isso a decisão mora numa função pura
  (`lib/cliqueDeLink.js`, com teste próprio) e o teste de ligação mede o **`preventDefault`**
  (`fireEvent.click` devolve `false` quando o padrão foi cancelado), nunca o desfecho na tela.
  Medir o desfecho ali é medir uma emulação errada — e foi o que fez o teste passar sozinho e
  falhar na suíte inteira.

## ⚠ A NAVEGAÇÃO É UMA BARRA LATERAL DE ÍCONES (21/08/2026)

Pedido do dono: *"vamos ter uma aba lateral, que terá ícones das outras funções"*. As abas
continuam sendo `<a href="#/…">` (a seção acima vale inteira); o que mudou é o desenho.

- ⚠ **SVG inline, nunca emoji, nunca biblioteca** (`src/components/icones.jsx`). O motivo do emoji
  já estava escrito no repo, no único precedente de ícone vetorial (`apps/web`, o hambúrguer da
  carteira): *"o caractere ☰ some em fonte sem o glifo e não escala com a cor do botão"*. E este app
  tem **três** dependências de produção — o mesmo argumento que recusou o SheetJS.
- ⚠⚠ **O ÍCONE NÃO É A ÚNICA MARCA DO DESTINO.** Todo SVG é `aria-hidden`; quem carrega o nome
  acessível é o link, com o rótulo em `.sr-only`. Isso também **mantém o `textContent`**, que é como
  os `getByRole("link", { name })` de várias suítes acham as abas.
- ⚠⚠ **O MAPA `ICONE_POR_ROTA` É FECHADO, E A FALHA APARECE.** Chave sem desenho cairia num link
  VAZIO — destino invisível numa barra que é só ícone. Quem cai na reserva (`?`) ganha o **rótulo
  visível ao lado** (`temIconePropio`), de propósito: é o mesmo modo de falhar que `chipDaGuia` já
  nomeia aqui, o valor fora da lista renderizando *"sem cor nenhuma, em silêncio"*.
- ⚠ **O breakpoint é 960 e a barra volta a ser LINHA HORIZONTAL no fluxo — não barra inferior
  fixa.** O protótipo (referência visual declarada deste portal) já colapsa em 960, e `app.css` já
  tinha o bloco. Barra fixa custaria `env(safe-area-inset-bottom)`, `z-index` abaixo do modal e o
  teclado virtual — orçamento que ninguém pediu. Se o dono a quiser, é commit separado.
- ⚠ **`min-width: 0` nas duas colunas da grade é obrigatório**: sem ele o item assume o
  `min-content` dos links e a **página inteira passa a rolar para o lado em 375px**, com o
  `.table-wrap` deixando de conter a tabela. É o comentário gêmeo do que a `.topbar` já carrega.

## ⚠⚠ A TELA INÍCIO v4 — DIAS LADO A LADO, HORIZONTE E AS SAÍDAS DO CLIENTE (29/08/2026)

> Dono, com a tela na frente: *"ao invés de mostrar o mês ele vai mostrar os dias mesmo, sendo assim
> ele vai colocar dois meses de uma vez quando a tela permitir, ou seja 30 dias à esquerda sendo o
> mês corrente e 30 dias à direita sendo o mês seguinte. Setas cabeçalho para andar para frente e
> para trás entre os meses, botão para ver o horizonte e aí mudamos a tabela para mês, e mantemos
> lateralizado, ou seja, coluna com entrada, saída, impostos, folha e resultado e logo abaixo o mês
> a que se refere. Um mês ao lado do outro. Todo dia 1 deve ter o valor de faturamento do mês
> anterior (…) o cliente pode modificar as saídas, podendo colocar novas saídas, **apenas para
> visualização deles**."*

⚠⚠ **ESTA É A QUARTA FORMA DO FLUXO EM SETE DIAS, E ELA INVERTE O v3.** A seção abaixo (v3, 28/08)
descreve a tabela de 12 MESES com drill-in de dias; ela **não existe mais**. Fica com a data, porque
este projeto já pagou caro por bloqueio anotado que envelheceu calado.

| | v3 (28/08) | v4 (29/08) |
|---|---|---|
| estado inicial | tabela de 12 **meses** | **dois meses lado a lado, em DIAS** |
| os dias | mergulho (*"os outros meses somem"*), 10 por vez | o padrão, **mês inteiro** desenhado |
| as setas | movem a **janela** de 12, e **somem** no mergulho | movem **um mês**, e nunca somem |
| a tabela de meses | o padrão | o **Horizonte**, atrás de um botão, **transposta** |
| a entrada da nota | "no mês" (prazo de recebimento em meses) | **dia 1** do mês seguinte |
| o cliente escreve | nada | **acrescenta saídas** ao próprio fluxo |

### ⚠⚠ OS DEZ DIAS SÃO ROLAGEM, E O "no mês" DESCEU PARA O RODAPÉ (30/08/2026)

**Duas correções do dono no mesmo dia, e as duas revertem decisões da tabela acima.**

> *"a tabela do fluxo deve mostrar apenas os 10 dias, para que sempre seja visto o dia em que
> estamos: 5 para trás e 4 para frente"* — e, logo depois, corrigindo o desenho que eu tinha feito
> para isso: *"os dias devem ser passados com **rolagem**, não com seta"*.
>
> *"esse **no mês** tem que sumir daí, e abaixo da tabela, no **footer** dela, deve haver um resumo
> da coluna: total de entrada, saída, impostos…"*

| | v4 (29/08) | hoje |
|---|---|---|
| quantos dias à vista | o mês inteiro, 31 linhas | **dez**, e o dia de hoje sempre entre eles |
| quem mostra dez | — | a **altura** de `.table-wrap--dias` (414px), nunca um `slice` |
| como se anda | — | **rolagem**; a caixa abre rolada em hoje−5 |
| a linha "no mês" | **primeira** de cada bloco | **fora do corpo**, virou o **total** do `<tfoot>` |

- ⚠⚠ **O MÊS INTEIRO CONTINUA NO DOM.** Cortar em JavaScript tiraria os outros dias de lá: quem
  rolasse não acharia nada, e quem usa leitor de tela nunca saberia que eles existem. `janelaDeDias`
  (o corte que existiu por algumas horas) **fica na lib, sem chamador e com teste** — é ela que
  define "onde a janela começa", e é dela que sai a rolagem inicial.
- ⚠⚠ **O DINHEIRO DO "no mês" NÃO SUMIU — ele mudou de lugar, duas vezes.** É ali que moram a folha
  e o imposto previsto sem dia. Hoje eles entram (a) no **resultado acumulado**, que começa por eles,
  e (b) no **total do rodapé**. Por isso o último dia e o rodapé fecham no mesmo número — conferido
  no navegador (13.600,45 nos dois). Somem-nos e a tela passa a mostrar menos dinheiro do que existe.
- ⚠ **O total é do MÊS INTEIRO, não dos dez à vista**: um número que mudasse com a rolagem seria um
  número diferente a cada olhada. Ele sai de `linhaDoMes` — a **mesma** agregação da tabela, nunca
  uma soma nova, que divergiria na primeira correção.
- ⚠⚠ **O rodapé é `sticky` no pé da caixa**, e sem isso ele só apareceria depois de rolar até o dia
  31. O `sticky` vai nas **células**, nunca no `<tfoot>` (elemento de agrupamento não aceita
  posicionamento, e a falha é silenciosa), com fundo **opaco**. ⚠ Ele só funciona porque essa caixa
  rola no vertical: **mexer no `max-height` desliga isto sem erro nenhum**.
- ⚠ **`<th scope="row">` no rodapé**, não um `<td>` solto — senão a linha de total vira cinco números
  órfãos para quem usa leitor de tela.
- ⚠ **Isto NÃO devolve a faixa branca** que o dono mandou tirar depois do Resultado. Aquela vinha de
  outra causa (a tabela era `width: auto` e ficava 227px mais estreita que o bloco); hoje ela é
  `width: 100%` da caixa de conteúdo, e a barra de rolagem fica **ao lado** da tabela, não dentro.
- ⚠ A conta da altura: linha do corpo ≈ 38px, cabeçalho ≈ 34px ⇒ `34 + 10 × 38 = 414`. **Mudar o
  `padding` de `.table--fluxo-v3 td` obriga a refazer a conta.**

### Onde cada coisa mora

| arquivo | o quê |
|---|---|
| `painel/lib/tabelaDoFluxo.js` | as 6 colunas, o status da célula, os dias, o modo % — **e a forma v4**: `parDeMeses`, `navegacaoDoPar`, `gradeTransposta` |
| `painel/lib/leituraDoFluxo.js` | o vocabulário do servidor + `saidasDoClienteNoFluxo` |
| `painel/BlocoDeDemonstracao.jsx` | só LIGAÇÃO: os dois blocos, o Horizonte, as setas, o alternador |
| `painel/SuasSaidas.jsx` | a lista do que o cliente acrescentou + o formulário "+ Saída" |
| `api/mock/fluxoDeCaixaDoMock.js` | o contrato offline — ⚠ ele **grava** as saídas do cliente e as devolve no fluxo |

### ⚠⚠ A ENTRADA DA NOTA CAI NO DIA 1, E A APURAÇÃO É QUEM A PROMOVE

> *"todo dia 1 deve ter o valor de faturamento do mês anterior"* · *"as notas emitidas do mês
> anterior se tornam a receita do mês seguinte, **comprovada quando há a apuração**, por isso entram
> no dia 1"*

⚠⚠ **A REGRA "dia ausente nunca vira dia inventado" CEDEU PARA ESTA FONTE, e só para ela.** Ela
continua valendo para recorrência, imposto previsto e folha — as três seguem em "no mês", nos dois
lados. O que mudou foi uma decisão de produto, não um afrouxamento da regra.

⚠⚠ **O QUE PROMOVE A LINHA A `FATO` É PROVA, NUNCA AFIRMAÇÃO:**
`CompanyMonthlyCircular.pgdasNumeroDeclaracao` (o índice da própria RFB) e
`ApuracaoSnapshot.estado === "transmitida"`. ⚠ `EntregaObrigacaoArquivo(PGDAS_D).transmitidaEm` é a
marca MANUAL do contador e **não é consultada** — há teste varrendo a fonte para provar.
⚠ A suposição viaja marcada: `base.simplificacao = "recebimento_presumido_pela_apuracao"` e
`base.apuracaoProvada`. Sem a marca, "confirmado" seria indistinguível de um recebimento provado, e
`PortalInvoice` não tem `recebidoEm`.

⚠⚠ **ISTO ABRE UMA EXCEÇÃO AO CRITÉRIO DE ACEITE Nº 12** (*"nenhum mês anterior ao corrente exibe
célula âmbar"*): mês passado sem apuração transmitida passa a mostrar entrada PREVISTA. Está escrito
no código e no teste, não escondido.

⚠ **`PortalClient.prazoRecebimentoMeses` ficou SEM LEITOR.** A coluna e a migration ficam (dropar
coluna é migration destrutiva e decisão do dono); `prazoDeRecebimento` está anotada como órfã, o
campo `prazoRecebimento` saiu do payload, do mock e da ressalva, com lápide nos três.

### ⚠⚠ OS TRÊS CARDS FALAM DO MESMO MÊS — conserto de defeito relatado

> *"o painel principal de receita, imposto líquido e resultado tem um bug: a receita está se tratando
> do mês seguinte e o resultado usando o mês corrente, o que gera confusão. Ele deve sempre usar o
> mês seguinte para as duas formas."*

A receita das notas de AGOSTO entra no fluxo em SETEMBRO. "Receita · agosto" mostrava as notas de
agosto; "Imposto" e "Resultado · agosto" liam a linha do mês CORRENTE, cuja Entrada é a receita de
JULHO. ⚠⚠ **Os dois números estavam CERTOS cada um por si** — o errado era apresentá-los como se
fossem do mesmo mês.

- Imposto e Resultado leem `competencia + 1`, e os **rótulos nomeiam esse mês**;
- ⚠⚠ **a RECEITA não muda de fonte** (Lei 5: *receita é nota emitida no mês, nunca dinheiro
  recebido*) — há teste prendendo isso pelo lado contrário;
- ⚠ o apoio do Resultado diz a ligação (*"a receita de 08/2026 entra aqui"*): sem ela, dois rótulos
  de meses diferentes lado a lado parecem erro de tela;
- ⚠ **as frases do card de imposto passaram a NOMEAR o mês** — elas diziam *"nesta competência"*
  debaixo de um rótulo que agora nomeia OUTRO mês. Achado no navegador, depois de os testes ficarem
  verdes.

### ⚠⚠ AS SAÍDAS QUE O CLIENTE ACRESCENTA

> *"o cliente pode modificar as saídas, podendo colocar novas saídas, **apenas para visualização
> deles**"* · avulsa ou recorrente? ***"as duas coisas"*** · pode mexer no previsto? ***"só
> acrescentar"***

| o que ele diz | onde mora | o que ela tem |
|---|---|---|
| *"dia 18/09 vou pagar 3.000 de reforma"* | `SaidaAvulsaCliente` (tabela NOVA) | **data** |
| *"todo mês pago 1.200 de aluguel"* | `SerieRecorrente`, `origem: DECLARADA` | **ciclo**, nunca data |

⚠⚠ **NENHUMA DAS DUAS É `LancamentoDeclarado`.** A invariante nº 1 daquele módulo exige
`dataPagamento`, porque o lançamento que sai dele é `D despesa / C caixa` — ele AFIRMA que o dinheiro
saiu. Uma saída planejada para o mês que vem não saiu de lugar nenhum.

⚠⚠ **A PENDENTE APARECE PARA O CLIENTE, e isto conserta a primeira versão.** Ela lia só
`CONFIRMADA` — o cliente digitava e não via nada até o contador conferir, o que contradiz *"apenas
para visualização deles"* em uma palavra. ⚠ **RECUSADA não entra**, e é isso que dá sentido à
recusa. ⚠ A conferência nunca foi o portão da VISUALIZAÇÃO: ela é como o contador fica sabendo.

⚠⚠ **A SÉRIE DECLARADA TAMBÉM ENTRA, E A DETECTADA NÃO** — o critério é o PAR (estado, origem), em
`serieEntraNoFluxo`. A decisão de 25/08 (*"o detector SUGERE e a linha só entra depois que o contador
confirma"*) está **intacta**: o que entrou é o caso que não existia quando ela foi escrita.

**Na tela (`SuasSaidas.jsx`):**

- ⚠⚠ **UMA linha por SAÍDA, nunca por ocorrência** — a recorrente mensal aparece em 8 meses da
  janela, e repetida daria 8 botões de remover para uma coisa só;
- ⚠ a lista sai do **MESMO payload** que a tabela desenha, nunca de uma segunda consulta;
- ⚠⚠ o valor usa `mascararValorDigitado`, a **mesma da emissão de nota** — `Number("1.500,00")` é
  `NaN`, e a gramática do número não pode divergir dentro do mesmo app. **ZERO não passa**
  (`required` do HTML deixaria);
- ⚠ **remover só o que ele criou, e só enquanto PENDENTE.** A conferida perde o botão e ganha a
  frase: o conserto não é esperar, é falar com o contador;
- ⚠ o `tipo` viaja no `DELETE` porque as duas formas moram em **tabelas diferentes**.

⚠⚠ **DOIS DEFEITOS FORAM ACHADOS NO NAVEGADOR, DEPOIS DE OS TESTES FICAREM VERDES**, e os dois são
da mesma família — o mock e o servidor discordando:

1. séries já confirmadas apareciam com "Remover" (o servidor não mandava o estado da SÉRIE, só o da
   avulsa). Hoje `base.estadoDaSerie` viaja, e a leitura normaliza os dois vocabulários
   (`CONFIRMADA` × `ATIVA`) na única pergunta que a tela faz: **está pendente?**;
2. a saída criada entrava no fluxo e **não aparecia na lista** — o mock usava `base.origem:
   "CLIENTE"` e `base.saidaId`, nomes que o servidor não usa. ⚠ Nenhum teste de unidade pegaria: a
   regra estava certa e o mock estava certo consigo mesmo. Nasceu daí
   `api/__tests__/saidasDoClienteNoMock.test.js`, que exerce a corrente inteira.

### ⚠ O QUE SAIU COM O v4 (anotado, não apagado)

- `DIAS_POR_VEZ` (a paginação de 10 dias), a migalha *"‹ Voltar aos meses"* e o *"Role para ver mais
  dias"* — o CSS deles está com lápide em `app.css`;
- a ressalva do **prazo de recebimento** e o campo `prazoRecebimento` do payload;
- ⚠ `ressalvasDoFluxo`, `evidenciaDaLinha` e `confrontoDaLinha` seguem **sem tela nos dois apps** —
  vivas só por teste. Elas não são código morto (são a leitura do vocabulário do servidor), mas o
  argumento antigo (*"continuam renderizadas no portal do contador"*) **ficou falso** quando aquele
  fluxo foi apagado.

---

## ⚠⚠ A TELA INÍCIO v3 — FASE 1 (28/08/2026)

> A **`CONSTITUICAO-do-produto.md`** abre dizendo: *"Este documento manda em todos os outros. Spec,
> plano, código e tela obedecem ao que está aqui; quando um deles contradisser esta página, é ele
> que muda."* **Leia-a antes de mexer em qualquer coisa desta seção.**

⚠⚠ **ESTA SEÇÃO INTEIRA FOI SUPERADA PELO v4 (29/08) — ver acima.** A tabela de 12 meses com
drill-in **não existe mais**. O que ela ainda responde, e por isso ela fica: a **Lei 1** e o que ela
mudou no PAYLOAD (a guia paga que não existia, a guia em aberto virando compromisso), a distinção
das três procedências, as duas simplificações declaradas e o "Estou ciente" — tudo isso atravessou
a mudança de forma intacto.

⚠⚠ **E AS DUAS SEÇÕES MAIS ABAIXO DESCREVEM TELAS AINDA MAIS ANTIGAS** — o fluxo diário com saldo
(23/08) e a planilha de quatro colunas com `Recorrência`/`Diário` (27/08). Ficam com a data, porque
este projeto já pagou caro por bloqueio anotado que envelheceu calado.

**Esta é a TERCEIRA forma do fluxo em seis dias**, e a Constituição explica por que a segunda caiu:
a coluna `Diário` era `saída ÷ dias do mês`, e o §4 a nomeia como *"o exemplo canônico do que este
teste barra"* — ela não respondia de onde veio, quanto valia de certeza, nem o que fazer com ela.

### O que a tela é hoje

`Mês | Entrada | Saída | Impostos | Folha | Resultado`, **12 linhas: 4 meses passados + o corrente +
7 futuros**, com setas ‹ › movendo a janela, toggles `Fluxo ⇄ DRE` e `R$ ⇄ %`, e o clique num mês
trocando a MESMA tabela pelos dias daquele mês (10 por vez, +10 na rolagem).

Acima dela, três cards — **Receita · Imposto líquido · Resultado** — e, quando há guia pegando fogo,
um **pop-up** (`role="alertdialog"`) que só some com "Estou ciente".

### ⚠⚠ A LEI 1 É O QUE MUDOU DE VERDADE — e ela mexeu no BACKEND, não na tela

> *"Dinheiro só confirma com pagamento. Contabilizado, emitido, gerado, vencido: nada disso é fato
> de caixa. Uma guia vencida e não paga não é saída de mês nenhum."*

| | antes | agora |
|---|---|---|
| guia **paga** | **não existia no payload** (`paymentStatus` filtrava só `OPEN`/`OVERDUE`) | `FATO`, no mês do **pagamento** |
| guia **em aberto** | `FATO`, no mês do **vencimento** | `COMPROMISSO`, no **mês corrente** |
| "vencida" | por **MÊS** | por **DIA**, comparado com um `hoje` injetado |

⚠⚠ **A GUIA PAGA SUMIA DO PAYLOAD INTEIRO** — nem em `meses`, nem em `semMes`, nem em `vencidas`.
Era ela, sozinha, que deixaria os 4 meses de passado vazios: tudo que foi pago tinha desaparecido.
**Sem esse conserto, a janela com passado não tinha como existir.**

⚠⚠ **E DAÍ SAI, SOZINHO, O CRITÉRIO DE ACEITE Nº 12** (*"nenhum mês anterior ao corrente exibe
célula âmbar"*): **o passado só carrega o que foi pago; todo compromisso em aberto migra para o mês
corrente.** Não é regra de tela — é o que a Lei 1 produz. A tela só não a desfaz.

⚠ A contagem por DIA fecha uma divergência que este arquivo já registrava: o card "A vencer" sempre
comparou com HOJE e o fluxo comparava com o MÊS. As duas telas passam a usar o mesmo dia.

### ⚠⚠ TRÊS NÍVEIS POR DENTRO, DUAS CORES POR FORA

`PROCEDENCIA` ganhou `COMPROMISSO`, entre `FATO` e `PREVISAO` (Constituição §1).

⚠⚠ **O SIGNIFICADO DE `FATO` MUDOU JUNTO, e é a parte que mais custa se for desfeita.** Ele queria
dizer *"existe, com data própria"* — e a guia GERADA e em aberto entrava nele. Hoje `FATO` é só o
que foi pago; o que era fato sem pagamento virou `COMPROMISSO`.

⚠ **`COMPROMISSO` não é uma previsão enfraquecida.** Ninguém está estimando nada: o valor e a data
são conhecidos, e o que falta é o dinheiro sair. Colapsá-lo em `PREVISAO` apagaria a diferença entre
*"o contador calculou isto"* e *"o sistema chutou pelo histórico"*.

⚠⚠ **ESTE PARÁGRAFO DIZIA "ATRAVESSA AS DUAS PORTAS" E FICOU FALSO EM 29/08/2026.** Ele mandava
manter `leituraDoFluxo.js` em sincronia nos DOIS apps, sob pena de toda guia em aberto cair no
fallback *"Esta tela não conhece esta procedência"*. **Hoje há UMA porta só:** o dono removeu o fluxo
de caixa do portal do contador (*"para o contador não vai existir fluxo de caixa"*), e
`apps/web/src/features/fluxo/` **foi apagada inteira** — a lib espelho junto.

⚠ **A regra em si não mudou**, e o cuidado que ela descrevia continua valendo DENTRO deste app:
valor novo de `PROCEDENCIA` no servidor sem entrada em `LEITURA_DA_PROCEDENCIA` cai no fallback, sem
erro nenhum. O que deixou de existir é a obrigação de sincronizar uma cópia.
⚠⚠ **Não recrie o espelho "por simetria".** Espelho sem consumidor não é código morto barato — é
trabalho de sincronização para sempre, numa cópia que ninguém abre.

⚠ Na tela, o status é derivado (`FATO → confirmed`, os outros dois → `forecast`) e a regra é a do
**elo mais fraco**: célula que soma guia paga com guia em aberto **não é fato**. A autoridade é
`statusDoConjunto` (backend); `features/painel/lib/tabelaDoFluxo.js` é espelho **amarrado por
teste** — ele importa a função de lá e exige o mesmo veredito, caso a caso.

### ⚠⚠ AS DUAS SIMPLIFICAÇÕES DECLARADAS — e elas viajam MARCADAS

Decisões de produto, não medições. As duas morrem na Fase 4.

1. **Nota de competência anterior ao mês corrente vira Entrada `confirmed`** (errata §7.1). Assume-se
   que 100% do faturado foi recebido — **`PortalInvoice` não tem `recebidoEm`**, então não existe
   prova de recebimento em lugar nenhum deste banco.
2. **Folha lançada conta como paga** (decisão do dono, 28/08). `derivarFolha12m` soma a PROVISÃO e
   **exclui o pagamento de propósito** — o sistema sabe o que foi lançado e não sabe se foi pago.

⚠⚠ **AS DUAS CARREGAM `base.simplificacao`.** Sem essa marca, "confirmado" seria indistinguível de
um pagamento provado, e não há nenhum. É o que torna a suposição auditável em vez de invisível.

### ⚠⚠ DUAS COISAS FORAM EXCLUÍDAS EM 28/08/2026, a pedido do dono

**1 · "Declarar o que se repete" — a feature INTEIRA.** Era a tela em que o cliente contava ao
contador o que se repete (*"essa é a taxa anual que pago de Conselho"*). Saíram: a pasta
`features/recorrencia/` (tela + regra + testes), `api.declararRecorrencia` nos dois lados, o botão
do Painel, o modo da casca, a rota `POST /client/companies/:id/recorrencia/declarar` e a função
`declararSerie`.

⚠⚠ **CONSEQUÊNCIA QUE FICA NOMEADA, e ela é uma perda real:** `ORIGEM_DA_SERIE.DECLARADA` ficou
**sem escritor** — nada, em lugar nenhum, cria uma série declarada. **O vocabulário CONTINUA**,
porque linhas com essa origem podem existir no banco e `leituraDoFluxo` lê `origem`/`valorDeclarado`
para mostrar o confronto. ⚠ **Não apague `DECLARADA` achando que é código morto: ela é LEITURA de
dado que já existe.**
⚠ E o caso que originou a feature — a taxa **ANUAL** do Conselho — ficou sem caminho nenhum: o
detector lê `PortalInvoice`, e uma anuidade paga por débito em conta não vira nota. `marcarSerie`
(a porta do contador) continua de pé, mas ela só marca o que o detector **enxerga**.

**2 · O card "Próximos vencimentos" do Painel.** Dono: *"a aba de próximos vencimentos tem que sair,
agora só o aviso do pop-up"*. Ele respondia a MESMA pergunta que o pop-up (a camada 1: *"tem algo
pegando fogo?"*), e duas respostas para a mesma pergunta é como a tela discorda de si mesma.

⚠ **Perda nomeada:** o pop-up só acende com guia **vencida** ou a **até 5 dias**. A guia que vence
em 15 dias aparecia ali e **deixa de aparecer no Início** — o caminho passa a ser a aba Guias.
⚠ Com ele, `api.getFluxo` perdeu o consumidor DESTA TELA (a rota e o par mock/real ficam).
⚠⚠ **E com isso morreu a divergência dos dois números sobre guia vencida** que este arquivo
registrava há dias: não há mais dois números na mesma página.

### O que NÃO existe nesta fase, e a fase de destino

| o quê | fase | por quê |
|---|---|---|
| coluna **Saldo** | 3 | **Lei 3**: sem âncora de conciliação não há acumulado. Erro por mês é tolerável; erro composto, não |
| presunções (média de 3 meses, alíquota da faixa) | 2 | §5 da Constituição |
| **DRE gerencial** | 4 | o desenho está fechado (`docs/dre-fluxo-caixa.md` §3.1, validado em 3 empresas) e **indisponível até o contador classificar** — R$ 687.355,94 medidos em conta EM BRANCO |
| recorrência **automática** | 4 | §7.2 — corte consciente; até lá só as séries marcadas pelo contador |
| registro de recebimento | 4 | mata a simplificação nº 1 acima |

⚠ **O botão DRE continua abrindo a ficção com selo**, como antes — e isso é uma DIVERGÊNCIA
DELIBERADA do meu plano, que dizia desabilitá-lo. A Constituição não manda removê-lo, ele já é
rotulado pelo selo, e tirar uma visão que funciona não é trabalho da Fase 1. Fica nomeado.

### As três reversões, com o argumento que derrubam

Registradas no §6 da Constituição. **Nenhuma é detalhe de implementação.**

1. ⚠⚠ **Existe um número que soma fato com previsão** (o `Resultado`). `fluxoDeCaixa.js:9-12`
   proibia: *"um número único somando o que aconteceu com o que talvez aconteça é exatamente o que
   alguém imprime e leva ao banco"*. **O que sustenta a reversão:** o `status` é por célula e o
   Resultado **herda previsto** de qualquer parcela — ele nunca se apresenta como certo. E o saldo
   acumulado **continua proibido**.
2. ⚠ **Dado de pessoal desceu para o piso do fluxo.** A coluna Folha aparece para qualquer membro
   ativo, e o `CLAUDE.md` da raiz manda `CLIENT_ADMIN`+ para pró-labore/sócios. Decisão do dono,
   contra a minha ressalva de que o FINANCEIRO passa a ver a folha.
3. ⚠⚠ **Saiu todo o texto explicativo** (§3 da Constituição: *"a hierarquia explica, não o texto"*).
   Foram-se a lista de evidência, as ressalvas e o `<details>` "Como este fluxo é calculado".
   **Eu argumentei contra e ele decidiu** — o critério escrito deste app manda o contrário, e a
   evidência era o que separava "previsto" de "chutado". **O que segura a decisão:** a REGRA não foi
   apagada (`evidenciaDaLinha`, `confrontoDaLinha`, `ressalvasDoFluxo` seguem em `leituraDoFluxo.js`,
   com teste, e continuam renderizadas **no portal do contador**), e a pergunta *"de onde veio esse
   número?"* ganhou lugar próprio: o drill-in de dias.
   ⚠ **A distinção não virou só cor.** Previsto = **cor + itálico + `data-status` no DOM +
   `aria-label` na célula**. Itálico sobrevive à impressão em preto e branco; o `aria-label` é o que
   existe para quem usa leitor de tela.

### ⚠ O CIANO DO SPEC NÃO PASSAVA COMO TINTA DE TEXTO

Medido: `#0891B2` dá **3,68:1** sobre o branco e **3,54:1** sobre o próprio `--ciano-surface` —
abaixo do mínimo de 4,5:1. `#0E7490` mede **5,36:1** e **5,15:1**. A errata §7.4 da Constituição
adotou a separação: **texto no escuro, borda e marca de posição no claro** (borda não é texto).

⚠ O traço da célula vazia (`--traco`, **1,47:1**) é invisível **de propósito** (v3 §3.2, *"sem peso
visual"*) — e por isso ele leva `aria-hidden` mais um `.sr-only` dizendo *"sem lançamento"*. Sem
isso, "vazio" e "não carregou" ficam iguais para quem não vê a tela.

### ⚠⚠ "ESTOU CIENTE" NÃO PAGA NADA

`CienciaDeGuias` (tabela NOVA, migration `20260828160000` — ⚠ **escrita e NÃO aplicada**, não há
banco alcançável nesta máquina) guarda *"eu vi o aviso"*. **`Guide.clienteConfirmouEm` guarda outra
coisa**: *"eu paguei esta guia"*, e move `paymentStatus`. A Lei 5 fecha a palavra: **Ciência nunca
significa pagamento**. Um clique dado para dispensar um modal não pode tirar do contador a cobrança
nem do cliente a dívida. ⚠ Há varredura de fonte no `PopUpDeGuias.jsx` provando que ele não encosta
em pagamento.

- ⚠ O que se guarda é o **CONJUNTO de ids**, nunca um carimbo de data: a guia que vence amanhã
  ficaria silenciada por um clique dado antes de ela existir.
- ⚠ **Sem a tabela (P2021), a queda é para AVISAR** — nunca para calar. Esconder guia vencida é o
  modo de falhar caro.
- ⚠ **`Esc` fecha sem gravar** (v3 §1): a confirmação é só pelo botão.
- ⚠ **Falhou ⇒ o pop-up FICA**, com o motivo. Fechá-lo faria a pessoa achar que registrou.

### Onde cada coisa mora

| arquivo | o quê |
|---|---|
| `features/painel/lib/tabelaDoFluxo.js` | as 6 colunas, o status da célula, os dias, o modo % — **regra pura, com teste** |
| `features/painel/BlocoDeDemonstracao.jsx` | só LIGAÇÃO — ⚠ **o drill-in saiu no v4**: hoje são os dois blocos de dias e o Horizonte |
| `features/painel/PopUpDeGuias.jsx` | o alertdialog, reusando `useDialogoModal` |
| `api/mock/fluxoDeCaixaDoMock.js` | o contrato offline — ⚠ **obedece ao critério nº 12**, senão a tela offline mostraria âmbar no passado |
| ⚠ `features/painel/lib/planilhaDoFluxo.js` | **sem consumidor** desde 28/08 (era a grade de 4 colunas). Anotado, não apagado |

⚠ **`ItemDaEvidencia`, `EvidenciaDoMes` e `RESSALVAS_FORA_DESTE_PORTAL` foram APAGADOS**, com lápide
no arquivo: componente órfão DENTRO do arquivo é ruído; o que é de fora (a regra) ficou.

---

## ⚠⚠ O PAINEL — O FLUXO DE CAIXA VIROU REAL EM 27/08/2026; O DRE CONTINUA FICÇÃO

⚠⚠ **AS DUAS SEÇÕES ABAIXO DESCREVEM O ESTADO ANTERIOR, E FICAM AQUI COM A DATA.** Elas dizem
*"MOCKADOS"* e *"o fluxo é DIÁRIO"*, e as duas coisas deixaram de ser verdade — este projeto já
pagou caro por bloqueio anotado que envelheceu calado.

**O que mudou, e o que NÃO mudou:**

| | antes | agora |
|---|---|---|
| fluxo de caixa | ficção diária, gerada no navegador | **`GET /client/companies/:id/fluxo-de-caixa`** — ⚠ dizia *"o MESMO payload que o contador lê"*, e isso ficou FALSO em 29/08/2026: o contador **não tem mais fluxo de caixa**, e a porta `/firm/.../fluxo-de-caixa` foi removida. O corpo compartilhado (`routes/fluxoDeCaixaHttp.js`) continua sendo o único que monta o fluxo — com um consumidor só |
| forma | 1 mês, dia a dia, com **saldo acumulado** | **12 meses**, `fato` e `previsao` separados, **sem `total` e sem saldo** |
| selo | sempre aceso | **some** — o servidor responde `demonstracao: false` |
| DRE | ficção | **continua ficção**, com o selo, porque **não existe rota de DRE** |

- ⚠⚠ **O SELO SOME PORQUE O SERVIDOR AFIRMA, e é exatamente o que o `realApi` previa por escrito:**
  *"quando a rota existir, troque o corpo por `pedir(...)` e o backend passa a responder
  `demonstracao: false` — o selo some sozinho"*. A regra `demonstracao !== false` **não mudou** (ver
  a seção abaixo, que continua valendo inteira): AUSENTE NÃO É `false`, e o campo é uma linha do
  `FluxoDeCaixaService`, com teste próprio na api. ⚠ A moldura tracejada (`.demonstracao`) saiu
  junto do selo: mantê-la diria "isto é maquete" por desenho depois de o aviso sumir.
- ⚠⚠ **A FORMA DIÁRIA NÃO PODIA SOBREVIVER, e não é gosto:** as projeções **não têm dia** (o prazo
  de recebimento é contado em meses, a recorrência diz o ciclo) e **não existe saldo acumulado**
  (sem saldo inicial não há o que acumular). A coluna "Saldo" afirmava as duas coisas.
- ⚠ **`PainelDoDia.jsx` e `lib/dadosDeDemonstracao.diasDoMes` ficaram SEM CONSUMIDOR.** Não foram
  apagados — apagar componente é decisão à parte, com precedente escrito neste projeto
  (`DefisNaoDevida.jsx`). `lib/__tests__/fluxoDiario.test.js` continua verde sobre a função pura.
  ⚠ `__tests__/diaDoFluxo.ligacao.test.jsx` **foi removido** e substituído por
  `__tests__/fluxoNoPainel.ligacao.test.jsx`, que carrega as invariantes que sobreviveram — entre
  elas a de que **este portal não escreve contabilidade** (nenhum `+`, nenhum `⋮`).
- ⚠⚠ **A LEI DE COR MORA EM `features/painel/lib/leituraDoFluxo.js`**, com teste próprio. ⚠ Ela
  **era ESPELHO** da do contador e deixou de ser em 29/08/2026, quando o fluxo saiu daquele portal —
  hoje é a única, e o verde proibido é `--success` (a paleta é clara).
  **PREVISÃO nunca é verde**, nem o FATO — uma guia gerada e em aberto não está paga —, e a palavra
  *"Previsto"* vai no **TEXTO** do chip, não só na cor. Experimento executado: pondo a classe `ok`
  na previsão, a suíte da regra fica **2 vermelhos**.
- ⚠⚠ **NÃO EXISTE `total`, nem no mês nem no bloco recolhido.**

### ⚠⚠ E A FORMA VIROU UMA PLANILHA — MESES NAS COLUNAS (27/08/2026)

> Dono, com a tela na frente: *"o fluxo de caixa está completamente esquisito"* — e, precisando:
> *"um monte de meses aparecendo, excesso de tabela, o fluxo deve se parecer mais com uma planilha
> excel"*.

⚠ **MEDIDO NO NAVEGADOR, no mock, antes de mexer** (1280px, `pc-001`, 08/2026):

| | 1280px | 375px |
|---|---|---|
| altura da página inteira | 2.325px | 3.605px (**4,4 telas**) |
| **só o bloco do fluxo** | **1.723px** | 2.570px |
| **fatia da página** | **74%** | **71%** |
| linhas de conteúdo em tudo isso | **7** | 7 |

Eram **11 blocos empilhados e 3 tabelas** — uma `<section>` por mês, cada uma com `<h3>`, bloco de
totais e tabela própria — mais 4 caixas de ressalva ocupando **247px antes do primeiro número**.

⚠⚠ **E A LINHA NÃO ERA UMA LINHA: ERA UM PARÁGRAFO.** Cada `<tr>` empilhava **4 a 6 blocos de texto**
numa célula (rótulo, chip, origem, evidência, confronto) — 76 a 110px de altura, contra ~40px de uma
linha normal, e até **183px em 375px**. A coluna "Quando" carregava frases inteiras, e elas se
repetiam: *"A recorrência diz de quanto em quanto tempo, não em que dia do mês."* aparecia **três
vezes** na mesma tela.

⚠⚠ **A CAUSA NÃO ERA A GRANULARIDADE.** A forma ANTERIOR a esta era diária e tinha a mesma doença:
31 linhas, 24 vazias. Trocar de dia para mês mudou o eixo e manteve o vazio — 8 dos 12 meses não têm
nada. O que produz o vazio é **renderizar um compartimento por período**, exista movimento nele ou
não.

**Hoje é UMA grade**: 12 meses nas colunas, quatro linhas (`Entra`/`Sai` × `Já existe`/`Previsto`),
e o detalhe de UM mês abre no clique do cabeçalho.

- ⚠⚠ **NÃO HÁ LINHA DE TOTAL, e a ausência é o contrato.** Um rodapé "No mês" somaria `fato` com
  `previsão` — exatamente o número único que a API se recusa a entregar. **As quatro linhas SÃO os
  totais**, separados por procedência; é por isso que são quatro e não duas.
- ⚠ **Zero sai como TRAÇO, nunca `R$ 0,00`.** A parede de zeros é a doença que a forma desfez, e
  "nada neste compartimento" não é a mesma afirmação que "zero reais".
- ⚠ **A evidência não foi apagada — ficou a um clique.** Ela é a diferença entre "previsto" e
  "chutado"; o que mudou é ela não estar toda aberta ao mesmo tempo. Os testes CLICAM em vez de
  baixar a asserção.
- ⚠ **A primeira coluna gruda** (`position: sticky`): rolar uma planilha larga e perder o nome da
  linha transforma um número em enigma.
- ⚠ **As ressalvas de tom `aviso` continuam ANTES da grade** — a guia vencida é a linha mais urgente
  do fluxo e não mora em mês nenhum. **As de tom `info` desceram**: são contexto, não ação.
- ⚠ `MESES_ABERTOS_POR_PADRAO`, `separarMeses` e `totalDoBloco` podem ficar sem consumidor. Se
  ficarem, **anotar, não apagar** — é a regra desta casa.
- ⚠⚠ **ESTE ITEM DIZIA "ISTO DIVERGE DO PORTAL DO CONTADOR" E FICOU SEM OBJETO EM 29/08/2026.**
  Ele explicava por que a FORMA divergia enquanto a REGRA continuava espelho. **Não há mais com o
  que divergir:** `apps/web/src/features/fluxo/` foi apagada e o contador não tem fluxo de caixa.
  Fica registrado porque o argumento continua valendo para qualquer tela futura: o que se
  sincroniza entre portais é a REGRA, nunca o desenho — este aqui é lido no celular e tem os cards
  reais da empresa acima dele.
- ⚠ **A ressalva tem TÍTULO PRÓPRIO, e nenhum se repete** (`ressalvasDoFluxo`). Isto é conserto de
  um defeito achado no navegador no portal do contador no mesmo dia: três caixas de aviso empilhadas
  dizendo *"Sobre este fluxo"*, indistinguíveis — o defeito que o `titulo` obrigatório existe para
  impedir.
- ⚠⚠ **DOIS NÚMEROS SOBRE GUIA VENCIDA CONVIVEM NA MESMA PÁGINA, e o dono precisa saber:** o card
  "A vencer" sai de `getFluxo` (a lista de guias liberadas em aberto) e compara com **HOJE**; a
  ressalva "N guias já venceram" sai do fluxo e compara com o **MÊS**. Em produção as duas varrem a
  MESMA população, então elas concordam — **exceto** para a guia que vence mais adiante no mês
  corrente e cujo dia já passou. Não é defeito de nenhum dos dois: são perguntas diferentes.
  ⚠ **Offline eles divergem sempre**, porque o mock do fluxo não é derivado da fixture de guias — o
  motivo (ramos que se perderiam) está escrito em `api/mock/fluxoDeCaixaDoMock.js`.
- ⚠ **`GET /client/.../fluxo` FICA COMO ESTÁ** — ela virou um CONTRIBUINTE deste fluxo, não uma
  segunda definição dele. Somar as duas seria a tela discordando de si mesma.

---

## ⚠⚠ O PAINEL — FLUXO DE CAIXA ⇄ DRE, MOCKADOS (21/08/2026) — ⚠ SUPERADO EM 27/08 PARA O FLUXO

> Dono: *"por padrão o portal vai exibir um fluxo de caixa, mockado por enquanto pois não temos back
> end, junto disso teremos de alterar para um DRE, também mockada por enquanto"*.

`features/painel/PainelPage.jsx` é o que a rota `home` renderiza. **A antiga `HomePage` foi
absorvida, não descartada**: o seletor `#competencia-home` e as três consultas REAIS do resumo do mês
continuam ali — quatro casos de `competenciaAtravessaAsAbas.ligacao.test.jsx` medem exatamente isso,
e cairiam **por motivo certo** se o painel os perdesse.

- ⚠⚠ **NÃO HÁ BACKEND PARA NENHUM DOS DOIS, E NÃO HÁ ORIGEM PARA ENTRADAS.**
  `GET /client/.../fluxo` **existe e NÃO é fluxo de caixa** — é a lista de guias liberadas em aberto,
  só saídas. ⚠⚠ **`POST .../ofx/import` DEIXOU DE SER STUB** — ele está implementado e no ar desde
  24/08/2026 (`ImportOfxService`), e o extrato em **Excel** ganhou porta própria em 28/08/2026
  (`POST .../extrato-excel/import`). O que os dois alimentam é a FILA DE CONFERÊNCIA do contador,
  não o fluxo de caixa — por isso a frase acima continua valendo sobre o PAINEL. `GET .../transactions`
  continua stub **501**. E nota emitida não é
  dinheiro recebido. Os números vivem em `features/painel/lib/dadosDeDemonstracao.js`.
- ⚠⚠ **O SELO É DIRIGIDO PELO DADO, E A LEITURA É `demonstracao !== false`.** Nunca `=== true`:
  resposta que não traga o campo apresentaria **ficção como fato, em silêncio** — é a mesma armadilha
  do `select` explícito, e a mesma regra do portão (`AUSENTE NÃO É false`). ⚠ E **nunca `api.mode`**:
  o aviso "Modo demonstração" do login vive dele e **some no modo real**. Experimento executado:
  trocando a leitura por `api.mode === "mock"`, `seloDeDemonstracao.test.jsx` fica 1 vermelho.
  No dia em que o backend existir, ele responde `demonstracao: false` e o selo some sozinho.
- ⚠⚠ **O SELO FICA NO BLOCO, ACIMA DOS NÚMEROS — nunca na página.** Na página, ele faria o cliente
  ler como fictícios também os números REAIS do resumo do mês, logo abaixo. `data-demonstracao` vai
  no DOM, auditável, como `data-status` e `data-estado-nota`.
- ⚠⚠ **NADA ATRAVESSA A FRONTEIRA.** A saída fictícia não é somada nem comparada com o "A vencer"
  real, e a demonstração **não é semeada com o faturamento da empresa** — no instante em que a
  receita bate com o número verdadeiro, o resto herda a credibilidade dela e a peça inteira passa a
  ser lida como real. Números redondos (múltiplos de 500), de propósito.
- ⚠ **"DRE" é NOME DE PEÇA CONTÁBIL.** O portal do escritório não entrega balanço/balancete a partir
  de dado insuficiente; aqui o dado é **inventado**. O selo é o que separa uma maquete de uma
  afirmação contábil — e por isso a visão de DRE **não oferece exportar, imprimir nem baixar**: o
  risco não é a tela, é ela SAIR da tela.
- ⚠ **Fluxo ⇄ DRE são VISÕES, não rotas** — `<button>`, estado local. Inventar `#/dre` daria um hash
  que o `useRota` recusa e devolve ao padrão: o "filtro fantasma" dentro da própria tela.

### ⚠⚠ O FLUXO É DIÁRIO, E O DIA ABRE (23/08/2026) — ⚠⚠ SUPERADO EM 27/08/2026

⚠⚠ **NADA DESTA SUBSEÇÃO DESCREVE A TELA DE HOJE.** O fluxo passou a ser MENSAL e REAL (ver o topo
da seção do Painel). Ela fica porque três decisões daqui continuam valendo em outros lugares do app:
a **primeira linha clicável** e o argumento sobre `role="button"` em `<tr>`; a regra de que o selo se
repete dentro de um diálogo que COBRE o bloco; e a de que **este portal não escreve contabilidade**
(nenhum `+`, nenhum `⋮`) — essa última migrou para `fluxoNoPainel.ligacao.test.jsx`.

> Dono, com dois prints de um app de finanças na frente: *"mostrando os dias do mês, com ação para
> abrir o dia e ver quais foram as despesas daquele dia específico"*.

Era uma tabela de **seis MESES**; virou **um mês, dia a dia** (`dia · entradas · saídas · saldo`),
com `PainelDoDia.jsx` abrindo os lançamentos de um dia. ⚠ A forma mensal **não ficou ao lado** —
duas formas para a mesma tela divergem na primeira correção.

- ⚠⚠ **A PRIMEIRA LINHA CLICÁVEL DESTE APP**, e a decisão escrita contra ela continua valendo onde
  foi escrita: ela é sobre a lista de NOTAS (*"o destino seria a tela que pratica ato fiscal, e
  clique acidental ali é caro"*). Aqui o destino é um painel de LEITURA. ⚠ A `<tr>` e o `<button>`
  do dia chamam o MESMO handler e **não há `stopPropagation`**: abrir o dia 18 duas vezes é abrir o
  dia 18. ⚠ E `role="button"` na `<tr>` seria errado — tiraria a linha da semântica de tabela.
- ⚠⚠ **O SELO SE REPETE DENTRO DO PAINEL.** O diálogo COBRE o bloco, e com ele o selo de lá — quem
  lê um valor tem de ter passado por um aviso. É a mesma regra que pôs o selo no bloco e não na
  página.
- ⚠⚠ **NÃO HÁ `+` NEM `⋮`** — os dois estão no print do dono. Este portal **não escreve
  contabilidade**: quem lança é o escritório, não há rota, e botão impossível é pior que ausência.
  Travado por teste que conta os botões do painel (só Fechar, Dia anterior, Próximo dia).
- ⚠ **O `‹ ›` não sai do mês** e DESABILITA nas bordas em vez de sumir: passar dali trocaria a
  competência da casca em silêncio, ou mostraria um dia que não está na tabela atrás.
- ⚠ **Os 12 meses lado a lado do print não foram replicados** — seria um segundo controle de
  período, contra a competência única.
- ⚠ **Sem a faixa de cor do saldo do print.** Só o negativo em vermelho: verde aqui significa
  CONCLUÍDO e âmbar permanente é proibido, e uma banda por faixa seria uma afirmação nossa sobre a
  saúde financeira da empresa, com limites que ninguém definiu.
- ⚠⚠ **A ORDEM DA PÁGINA MUDOU, E ELA É QUEM RESOLVE A ROLAGEM** (dono, 23/08/2026: *"coloque
  próximos vencimentos acima da tabela do fluxo, e coloque espaço abaixo o suficiente para que não
  precise rolar os dias"*). ⚠ **"Próximos vencimentos" SAIU em 28/08/2026** — hoje a ordem é
  `Início` → os três cards → o bloco do fluxo, e o aviso de guia é o **pop-up**.
  - ⚠ Enquanto o bloco era o PRIMEIRO, os 31 dias empurravam o conteúdo real para ~1.200px fora da
    dobra, e a tabela precisou de rolagem interna (`.table-wrap--alto`, com `thead`/`tfoot`
    grudados) para não fazer isso. Descido o bloco, o motivo caiu e a regra **saiu do CSS** em vez
    de virar código morto que parece fazer alguma coisa.
  - ⚠ **Se o bloco voltar a subir, o problema volta com ele** — a rolagem era conserto de ORDEM,
    não de tabela. E `position: sticky` dentro de um `.table-wrap` que não rola verticalmente é
    **inerte**: não gruda, não avisa, e ninguém percebe.
  - ⚠ O `overflow-x` do `.table-wrap` **fica**: em 375px a tabela (mínimo de 480px) rola DENTRO
    dela, senão a página inteira rola para o lado.
  - ⚠ A fronteira continua nítida: tudo **acima** do bloco é dado da empresa; ele é o único que não
    fala dela, e é o que carrega o selo.
- ⚠ O `tfoot` da coluna de saldo **não é a soma da coluna** (somar saldo acumulado não significa
  nada): é o saldo no fim do mês, e o `title` diz isso.
- ⚠ `diasDoMes` é o **primeiro gerador de dias do app** — e é por aritmética de string, nunca
  `toISOString()`: às 22h de Brasília ele devolveria o dia seguinte.
- ⚠ **`PainelDoDia` é o TERCEIRO diálogo com o mesmo miolo copiado** (`SeletorEmpresa`,
  `ConfirmarCancelamento`). Extrair um `Dialogo` comum é a hora certa — mas migrar o
  `ConfirmarCancelamento` mexe no fluxo de CANCELAMENTO de nota fiscal. **Próximo passo nomeado.**
  - ⚠⚠ **O MIOLO DOS TRÊS VIROU `useDialogoModal` (`lib/hooks.js`) EM 24/08/2026 — e isso NÃO é o
    `Dialogo` comum acima.** A distinção é o ponto: um hook troca o `useEffect` de cada um e **não
    toca uma linha de JSX**, então o markup do cancelamento fica intacto. O passo nomeado continua
    nomeado.
- ⚠ **A competência vem por prop, da casca.** Tela nova com mês nunca ganha
  `useState(competenciaPadrao)` — e o painel **não acrescenta um segundo controle "Competência"**:
  `getByLabelText("Competência")` explodiria com dois casamentos e derrubaria a suíte de ligação.
- ⚠ **Vermelho só no RESULTADO do DRE, nunca na dedução** — imposto sobre a receita é negativo por
  definição, e cor forte, nesta casa, quer dizer "isto pede ação agora".
- ⚠ **A série de demonstração alcança os ramos que a tela desenha**: sempre há um mês de saldo
  NEGATIVO e um mês SEM entrada. Este projeto foi mordido quatro vezes por ramo que só existia em
  produção.
- ⚠ `getFluxoCaixa`/`getDre` existem nos **dois** lados (`mockApi` e `realApi`) — `api/index.js` só
  envolve a chave quando as duas são função, e função só do mock **nunca é alcançada** no modo
  `real_with_mock_fallback`.

## ⚠ GUIA NÃO É NOTA — o `data-status` do chip

`GuiasPage` mapeava `PAID → "emitida"`, `OVERDUE → "rejeitada"`, `OPEN → "rascunho"`, e o Início
marcava guia vencida como `data-status="rejeitada"`. A cor saía certa por acidente; o significado,
não — e `data-status` é **auditável no DOM** e é o vocabulário que o app mobile espelha. Hoje há
`paga` / `vencida` / `aberta`, com as MESMAS superfícies (zero mudança visual, conferido no
navegador).

- ⚠ **O mapa é EXPORTADO e o Início o consome** (`chipDaGuia("OVERDUE").status`) em vez de cravar a
  string: um quarto valor solto numa segunda tela é como o vocabulário se parte.
- ⚠ **Há guarda, e ela lê o CSS de verdade** (`guias/__tests__/chipDaGuiaTemCor.test.js`): valor
  fora da lista de `data-status` renderiza **sem cor nenhuma, em silêncio** — o defeito que
  `lote/lib/__tests__/emissaoDoLote.test.js` já nomeia para as notas e que a guia não tinha.
  Uma lista copiada à mão teria o mesmo problema que ela quer resolver.

## ⚠⚠ `aria-modal="true"` ERA UMA PROMESSA NÃO CUMPRIDA — `lib/hooks.js`, `useDialogoModal`

Os três diálogos (`SeletorEmpresa`, `ConfirmarCancelamento`, `PainelDoDia`) declaravam
`role="dialog"` + `aria-modal="true"` desde que nasceram, mandavam o foco para a caixa e fechavam no
Esc. **Nenhum prendia o foco:** com Tab ele saía do diálogo e ia passear pela página atrás, que
continua inteira no DOM.

⚠ O atributo **afirma ao leitor de tela que o resto da página está inerte**. No cancelamento isso não
é conforto: dava para acionar o "Cancelar" de OUTRA nota da lista com o diálogo de cancelamento de
nota fiscal aberto por cima.

- ⚠⚠ **A LISTA DE FOCÁVEIS É RECALCULADA A CADA Tab, nunca na montagem.** O conteúdo destes diálogos
  MUDA com o uso: os `‹ ›` do `PainelDoDia` desabilitam nas bordas do mês, e o botão de enviar do
  cancelamento habilita conforme a justificativa cresce. Congelada, a lista mandaria o foco para um
  botão desabilitado — que não o aceita — e o Tab pareceria morto.
- ⚠⚠ **`atual === caixa` PRECISA CAIR NO RAMO DE CAPTURA**, e é o buraco fácil de deixar: `contains`
  inclui o próprio nó, então tratar só `!contains` deixaria o foco NA CAIXA de fora — e o
  **Shift+Tab** sairia do diálogo para trás. O Tab para a frente pareceria certo (o navegador já iria
  para o primeiro de dentro), então o furo só apareceria no sentido que quase ninguém testa.
- ⚠ **No MEIO da lista o handler não interfere** — prender o foco não é conduzi-lo; quem tabula é o
  navegador.
- ⚠ **`escFecha: false`** é o estado do cancelamento com o pedido em voo: o Esc não fecha, porque o
  desfecho pode estar em trânsito. **Isso não afrouxa a prisão do foco.**
- ⚠ **O foco VOLTA para quem abriu** — e só se ainda estiver dentro do diálogo. Se a página já o
  moveu (a `NotasPage` recarrega a lista ao cancelar), roubá-lo de volta seria pior que não devolver.
- ⚠ O teste é de LIGAÇÃO (`lib/__tests__/dialogoModalPrendeOFoco.ligacao.test.jsx`) e tinha de ser: a
  regra sozinha não provaria nada, porque o que estava errado era **ninguém a ter**.
  ⚠ **O jsdom não move o foco no Tab** — ele não implementa ordem de tabulação. As asserções são
  sobre o que o NOSSO handler faz (`preventDefault` + para onde ele manda o foco); medir "o Tab
  andou" ali seria medir uma emulação que não existe, a mesma armadilha de `cliqueDeLink.js`.
  Experimento executado: desligando a prisão, **5 vermelhos de 10**. Conferido também no navegador,
  com o diálogo real e os 8 focáveis de verdade.

## ⚠⚠ A ARMADILHA DO `<dl>` — especificidade não resolve o que não é DECLARADO

Defeito relatado pelo dono em 23/08/2026, com o modal de cancelamento na tela: "Número" e "Valor"
saíam com **uma letra por linha** (`1/5/8`, `R/$/1/,/0/0`).

Não havia regra errada — havia **duas regras certas se atropelando**. `app.css` tem, desde a tela de
emissão (`5bd8e464`), um `dl` genérico para a prévia da nota:

```css
dl    { display: grid; grid-template-columns: 1fr auto; … }
dl dd { text-align: right; overflow-wrap: anywhere; … }
```

e o `.dados-da-nota` do modal declarava `display: grid` e `gap` — mas **nunca**
`grid-template-columns`. **Especificidade só decide o que os dois lados declaram**: sem competição, o
valor genérico se aplicou. Os quatro pares viraram grade de DUAS colunas, a segunda (`auto`) foi
comida pela razão social do tomador, a primeira (`1fr`) colapsou, e o `overflow-wrap: anywhere`
quebrou o resto letra a letra.

⚠⚠ **O GATILHO ERA O DADO, e é por isso que ele sobreviveu meses**: com tomador de nome curto, o
mesmo defeito parecia só um alinhamento estranho.

⚠ **`<dl>` novo declara `grid-template-columns` E `text-align` no `dd`.** Travado por varredura da
FONTE em `notas/__tests__/dadosDaNotaTemColunas.test.js`, que percorre todo `<dl className>` do app
— não só o que quebrou. Experimento: tirando o conserto, 2 vermelhos.

## ⚠ O `style={{}}` — a erosão foi cortada enquanto era barata

Medido em 20/08/2026: ~20 objetos inline num app que é de classes, com as reincidentes já nomeadas
(`fontSize:".78rem"` 5× só em `NotasPage`, `marginTop:"var(--gap)"` 6× nas telas de auth). É o
começo exato do que virou ~2.200 no portal do escritório, onde hoje custa caro desfazer. Entraram
`.meta`, `.meta--bloco`, `.meta-erro`, `.stack-gap` e `.select-auto` — e `.card-header`, porque
`.page-header` fazia dois papéis (cabeçalho da PÁGINA e, dentro de um card, de SEÇÃO, com um `style` corrigindo a
margem). **Estilo novo entra em `app.css`.**

## ⚠⚠ O FALLBACK — `src/api/index.js:39`

Três modos, por `VITE_API_MODE`: `mock` (padrão), `real`, `real_with_mock_fallback`.

```js
function deveCairParaMock(err) {
  const status = Number(err?.status);
  if (status === 0) return true;   // falha de rede: não houve resposta
  if (err?.code) return false;     // recusa NOMEADA: o servidor respondeu, e a resposta é essa
  return Number.isFinite(status) && status >= 500;
}
```

A linha 42 é de 19/08/2026. **Antes a regra era só `status >= 500`**, e há recusas DELIBERADAS do
backend nessa faixa. O que isso produzia no modo fallback (commit `fe04ac48`):

- **`503 danfse_sem_qrcode`** → o mock devolvia um **PDF válido** no lugar da recusa. Um DANFSe sem
  QR Code não é um DANFSe (NT 008 §2.2/§2.4.3): era exatamente o documento inválido servido em
  silêncio que aquele 503 existe para impedir.
- **`502` da camada TRANSPORTE da emissão** → o mock respondia **`status: "issued"`**. O desfecho
  real é DESCONHECIDO (a DPS pode ter sido processada), e a tela dizia ao cliente que a nota saiu.
  É assim que se duplica nota.
- **`503 mail_not_configured`** → o mock fingia que o e-mail de redefinição de senha foi enviado.

⚠ O que separa os dois casos é o **CORPO**, não o status: backend fora do ar não responde o nosso
JSON, logo não tem `code`. Fallback por rede e por 5xx sem corpo seguem intactos. 401/403 nunca
caem para o mock — senão o modo fallback vira bypass de login.

⚠ **`brasilApi.js` nunca lança `ApiError`** (`{ok:false, motivo}` sempre), e isso é deliberado: um
erro lançado dali entraria no wrapper acima e a queda da BrasilAPI viraria **dados de empresa do
mock** numa tela que emite nota fiscal de verdade.

⚠ **Toda função nova precisa existir nos DOIS** (`mockApi` e `realApi`), com o mesmo contrato. Um
mock que recusa o que o real aceita treina a tela errada — foi o caso do `emitirNfse` do mock, que
julgava só o payload e por isso recusava **todo** Lucro Presumido, inclusive o de cadastro completo
(consertado em `df520df3`).

⚠⚠ **AS EMPRESAS DO MOCK SÃO SETE, E O EIXO DE CADA UMA É DELIBERADO.** Quatro cobrem o PORTÃO;
`pc-005`/`pc-006` abriram o eixo do REGIME (Presumido com carga completa × incompleta); e **`pc-007`
é o REGIME INDEFINIDO COM O FORMULÁRIO ABERTO**, acrescentada em 20/08/2026. As `pc-002/003/004` já
tinham `legacyCompany: null`, mas **nenhuma passa pelo portão** — o formulário nunca montava, então
o ramo "não sei o regime desta empresa" só existia no papel, e é justamente nele que as três guardas
de imposto decidem coisas diferentes. ⚠ Nela o `regimeTributario` é uma chave **AUSENTE**, não
`null` nem `"INDEFINIDO"`.

⚠ **A MEMÓRIA DE TOMADORES DO MOCK cobre os três estados**: `pc-001` com três registros (um **sem
e-mail**, um **CPF sem endereço nenhum**), `pc-005` com um (a memória não tem nada a ver com
regime), e `pc-006`/`pc-007` com **nenhum** — que é o caso em que o seletor não aparece. ⚠ E só
`emitirNfse` escreve nela, **depois do sucesso**, como no par real: as recusas de RECEITA e de
TRANSPORTE não gravam.

## Estilo — paleta CLARA, própria

`src/styles/tokens.css`. **Não é a paleta de `apps/web`**: aquela é escura e é do portal do
ESCRITÓRIO. Esta foi copiada verbatim de `prototipos/emissor-notas/styles.css`, decisão do dono com
a tela na frente, para que os dois lados do cliente (esta web e o app `portal-cliente-mobile`)
contem a mesma história visual.

Cor nova entra em `tokens.css`, nunca em hex dentro de componente. ⚠ Todo estado tem par
`-surface` (`--danger-surface`, `--warning-surface-border`, …) pelo mesmo motivo já registrado em
`apps/web/CLAUDE.md`: derivar fundo com `` `${cor}22` `` quebra em silêncio assim que a cor vira
`var(--…)`.

## A EMISSÃO DE NFS-e (`src/features/emitir/`)

⚠⚠ **É a única tela deste portal que ESCREVE.** O que sai daqui vira nota fiscal de verdade, e a
NFS-e **não tem inutilização**: o conserto de uma nota errada é cancelamento, outro ato fiscal, com
prazo e motivo. Contrato: `POST /client/companies/:companyId/nfse`; corpo em
`apps/api/src/application/validators/nfsePayload.js`; desfechos em `routes/nfseEmissaoHttp.js`.

### O portão — `lib/portaoEmissao.js:44`

Espelho de `ensureEmissaoNfseAutorizada` (backend): empresa liberada pelo contador **E** papel ≥
`CLIENT_ADMIN`. Existe só para a tela não montar um formulário que já se sabe que vai ser recusado.

⚠⚠ **AUSENTE NÃO É `false`.** São quatro estados, e `DESCONHECIDO` é o que impede a tela de dizer
"peça a liberação ao seu contador" para uma empresa que talvez já esteja liberada — o cliente
ligaria para o escritório atrás de algo já feito, e o contador não acharia nada para consertar.
⚠ `bruto !== true`, nunca truthy: `Boolean("false")` é `true`, e portão que abre por coerção de tipo
é o que ninguém revisa.

### ⚠⚠ O valor — `lib/valorDaNota.js`

**Aqui o erro é de ordem de grandeza, não de estética.** O que este módulo substituiu era
`Number(String(v).replace(",", "."))` — um `replace` do PRIMEIRO caractere:

| grafia | resultado antigo | o que quis dizer |
|---|---|---|
| `1.500` | `1.5` | mil e quinhentos |
| `1.500,00` | `NaN` (campo preenchido, "vazio" para a regra) | mil e quinhentos |
| `1500.00` | `1500` (certo, por acaso) | mil e quinhentos |

A do meio emite a nota por **1/1000** do valor.

⚠ **A decisão: a ambiguidade não é resolvida, é impossível de escrever.** `mascararValorDigitado`
lê o teclado como FLUXO DE DÍGITOS em centavos e devolve sempre `1.234,56`. Digitar `1500.00` é
impossível — o ponto não entra. Ambiguidade que não pode ser escrita não precisa ser resolvida.

⚠⚠ **Colar é o caso perigoso, e tem gramática FECHADA** (`lerValorColado`, `:143`). Quem cola vem
de planilha, e planilha escreve `1500.00`, `R$ 1.500,00` ou `1,500.00` conforme a máquina. Aceitas:
`1500`, `1500,00`, `1.500,00`, `1,500.00`, `1500.00` (ponto com 1–2 casas nunca é milhar pt-BR).
Recusadas **com motivo próprio** (`:171-172`): `1.500` e `1,500` — as duas leituras são legítimas e
não dá para escolher. Campo intocado + frase dizendo o que houve é melhor que um número plausível e
errado.

⚠ **Zero digitado ≠ campo vazio.** `""` continua `""`; `lerValorDoCampo("")` devolve `null`, não
`0`. E `formatarValorParaCampo` devolve `""` para o que não é número positivo — campo pré-preenchido
com `0,00` afirmaria que a nota vale zero.

⚠ **Isto NÃO vale para percentual.** Alíquota e `pTotTribSN` continuam aceitando vírgula E ponto:
percentual de 0 a 100 não tem separador de milhar, logo não tem a ambiguidade. Reusar a máscara de
moeda lá transformaria `5` em `0,05`.

### ⚠⚠ A alíquota — `lib/aliquotaEfetiva.js`

**É `deReceita` (DAS ÷ receita da competência), NUNCA `efetiva`.** A rota
`GET /client/companies/:id/aliquotas` devolve as duas contas, e só uma serve aqui:

```
deReceita = dasExtrato    / faturamento × 100   ← ESTA (pTotTribSN)
efetiva   = impostosPagos / faturamento × 100   ← inclui INSS; NÃO usar aqui
```

O motivo é o NOME DO CAMPO: `pTotTribSN` é "total de tributos do **Simples Nacional**", e o INSS
recolhido em guia separada (CPP do Anexo IV) não está dentro do DAS. Decisão do dono, 18/08/2026:
*"a alíquota efetiva do Simples, ou seja apenas a DAS, o INSS não entraria."* Medido em produção e
registrado no cabeçalho do arquivo: onde não há INSS à parte as duas coincidem (6,00%); onde há,
divergem em mais de um ponto (6,00% × 7,26%; 6,00% × 7,83%; 6,24% × 7,01%).

⚠ **`efetiva` não é um campo errado — não a "conserte".** São duas perguntas diferentes, e o dono
fixou a distinção: o PAINEL responde *quanto esta empresa paga de imposto?* (tudo, INSS incluso — é
gestão); a NOTA responde *quanto desta nota é tributo do Simples?* (só o DAS — é documento fiscal).
Trocar uma pela outra estraga a tela de destino nos dois sentidos.

⚠⚠ **Zero nunca é fabricado.** O backend calcula `d > 0 ? n/d*100 : 0` — sem receita ou sem extrato
do PGDAS-D a resposta é `0`, indistinguível de uma alíquota de zero por cento, que numa nota fiscal
é uma AFIRMAÇÃO. Por isso `linhaTemProva` (`:45`) exige os DOIS insumos crus **e** o percentual
legível. E `percentualLegivel` (`:71`) não usa só `Number.isFinite(Number(x))`: **`Number(null)` é
`0`**, que é finito — a primeira versão da guarda errou nisso e a nota declarava 0%. É a mesma
armadilha do `fatorR` já registrada em `apps/web/CLAUDE.md`.

⚠ Sem a competência da nota, usa-se a **última apurada e diz-se qual foi** (`:110`) — nunca se
extrapola nem se repete o número anterior fingindo ser o do mês. A janela da consulta é de **6
meses, não 12** (`:159`): a rota faz um `aggregate` por competência, em série.

### ⚠⚠ OS CAMPOS DE IMPOSTO — `lib/impostosDaNota.js`

**Duas entregas de 20/08/2026, as duas relatadas pelo dono com a tela na frente.** O módulo existe
porque as duas são a MESMA pergunta: *quais campos de imposto esta nota leva?* — e a resposta tem de
valer para o que se RENDERIZA **e** para o que se ENVIA.

⚠⚠ **CAMPO ESCONDIDO QUE CONTINUA VIAJANDO É O DEFEITO PIOR.** A tela mostra uma coisa e o servidor
recebe outra, e quem confere a tela nunca descobre. Por isso `montarPayload` recebe `regime` (não um
punhado de booleanos) e chama o MESMO `camposDeImposto` que o JSX chama. Dois parâmetros que
precisam concordar são dois parâmetros que um dia não vão concordar.

**1. `pTotTribSN` — o DEFEITO EM PRODUÇÃO.** *"empresa presumida aparecendo isso na nota: Alíquota
efetiva do Simples (%). Não pode."* O campo era renderizado **sem nenhuma condição de regime**,
enquanto os dois vizinhos já tinham a sua (o bloco de ISS sai no Simples; a carga tributária aparece
só no não optante).

- **Simples vê e envia**; **não optante não vê e não envia**; ⚠ **regime INDEFINIDO também não** —
  ali não se sabe qual grupo a nota leva, e um campo chamado "do Simples" é uma AFIRMAÇÃO sobre uma
  empresa cujo regime ninguém afirmou. É o critério do `0905d58e`, com o mesmo sinal.
- ⚠ Esconder **não fabrica recusa**: o servidor só exige `pTotTribSN` de quem é do Simples
  (`MISSING_P_TOT_TRIB_SN` está sob `if (isSimples …)`, `NfseService.js:626`), e o XML só escreve o
  grupo sob `isSimples` (`:952`).
- ⚠ **A PRÉVIA TEM A MESMA GUARDA.** A linha *"Tributos do Simples nesta nota"* aparecia com traço
  para o Presumido — e o traço não salva: a LINHA já afirma que a nota declara esse grupo.
- ⚠ Fora do Simples a alíquota efetiva **nem é pedida** a `GET /aliquotas`: dado que não se usa não
  se busca, e buscá-lo deixaria `form.pTotTribSN` preenchido para um regime que não o declara.

**2. A alíquota de ISS só existe com RETENÇÃO.** *"a alíquota de ISS é apenas se for retido, correto?
então só deve aparecer campo de alíquota se clicar na caixa de retenção de ISS."* Confirmado na
fonte, por três caminhos independentes:

- `NfseService.js:766` — a alíquota **só é exigida** com `issRetido === true`
  (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`);
- ela **não entra no XML**: `<tribMun>` (`:870`) leva só `tribISSQN` e `tpRetISSQN`. `NfseService` a
  grava em `ServiceInvoice.aliquota`, que é registro NOSSO;
- Anexo I: informar `pAliq` sendo **não optante** em município ativo é a rejeição **E0617**.

⚠ Marcada, ela é **obrigatória e > 0**, e a tela **recusa o submit** dizendo o que falta — como
`conferirCodigoEscolhido` já faz. ⚠ `required` do HTML **não basta**: um **zero** passa pelo
navegador e morre no servidor. ⚠ Desmarcada, o campo some **e o valor não viaja** — ele fica preso
no estado do formulário.
⚠ **Isto é só para o NÃO OPTANTE.** No Simples o bloco de ISS inteiro já sai da tela; nada aqui o
reintroduz (`aliquotaNoFormulario` depende de `issNoFormulario`, não só da caixa).

⚠ `REGIME` e `lerRegime` **mudaram-se para cá** vindos do `.jsx` — era lá que a guarda faltava.

### ⚠⚠ OS TOMADORES JÁ EMITIDOS — `lib/tomadoresEmitidos.js` + `SeletorTomador.jsx`

> Dono (20/08/2026): *"na aba de emissão deve haver um seletor para selecionarmos tomadores já
> emitidos."*

⚠⚠ **O CADASTRO JÁ EXISTIA E NÃO NASCEU AQUI** — `apps/api/src/application/nfse/tomadorEmitido.js`
(tabela `tomadores_emitidos`), alimentado por CADA emissão autorizada, escopado por empresa, com
documento, nome, e-mail e endereço completo. Foi construído em 19/08 exatamente para isto.
**Não crie outro.** O que faltava era a porta de LEITURA: `buscarTomadoresEmitidos` responde
*"conheço ESTE documento?"* (é o que o lote pergunta linha a linha) e ninguém respondia *"quem eu já
conheço?"* — daí `listarTomadoresEmitidos` + `GET /client/companies/:companyId/nfse/tomadores`.

⚠⚠ **`resolveLegacyCompanyId`, PELA QUINTA VEZ ESTA SEMANA.** O `:companyId` do path é um
`PortalClient.id`; `TomadorEmitido.companyId` é o da `Company` legada. Sem a resolução o `findMany`
volta **vazio, sem erro**: 200 na rota, "nunca emiti para ninguém" na tela, em silêncio. Travado por
varredura de fonte (`client/__tests__/tomadoresEmitidosDoCliente.test.js`), não por comportamento —
um dublê passaria. ⚠ Só o escopo da MEMÓRIA usa o id resolvido; o de ACESSO é o do path.

⚠ **SÓ LEITURA.** Não há POST/PATCH/DELETE de tomador em lugar nenhum, nem no `mockApi`: quem
escreve nessa tabela é uma nota que o sistema nacional autorizou. Uma tela de gestão transformaria o
registro do que a emissão TEVE num cadastro editável — outra coisa, que ninguém pediu.

**Na tela:**

- ⚠⚠ **ENCONTRA, NUNCA ESCOLHE** — nada pré-selecionado, **resultado único não se autosseleciona**,
  `Enter` sem item marcado não elege ninguém, e toda linha mostra NOME **e** DOCUMENTO. ⚠ `Enter`
  com a lista aberta sempre faz `preventDefault`: dentro de um `<form>` ele ENVIA, e este formulário
  emite nota fiscal.
- A escolha preenche **documento, nome, e-mail e o endereço inteiro**, e a origem fica à vista.
- ⚠⚠ **O DIGITADO VENCE, e escolher não apaga sem a pessoa ver.** Campo com conteúdo é PRESERVADO e
  volta NOMEADO ("Mantivemos o nome e o logradouro…"), com um botão para a SEGUNDA decisão. ⚠ **O
  documento é a exceção**: ele É a identidade da escolha, e preservá-lo deixaria o nome de um
  tomador com o CNPJ de outro — a nota sairia para a pessoa errada.
- ⚠ **Sem tomadores ⇒ o seletor não aparece, e NADA é dito** (*"sem sugestão não precisa ser falado,
  pois já está sem"*). Não confundir com o `"Não preenchemos: …"` da alíquota, que FICOU: aquele
  impede uma ausência de virar afirmação; este descreveria uma ausência já visível.
- ⚠⚠ **A ETIQUETA E A PRECEDÊNCIA SÃO COISAS DIFERENTES.** Contra a consulta da Receita (que o
  próprio preenchimento do documento dispara), o que veio da memória se comporta como
  `ORIGEM.DIGITADO` — foi um ato da pessoa. Mas o RÓTULO diz *"de uma nota já emitida"*, não
  "digitado". Um quarto valor em `ORIGEM` faria a cópia de `apps/web` divergir ("mudou lá, muda
  aqui"), então a etiqueta mora no `RotuloOrigem` desta tela.
- ⚠ Escrever por cima de um campo tira o rótulo **daquele grupo** (nome × endereço): a frase que
  descreve um comportamento é parte do comportamento.

### ⚠⚠ O tomador — `lib/consultaTomador.js`

**CPF NÃO SE CONSULTA** (`:53`). Com 11 dígitos NADA acontece: sem chamada, sem "não encontrado",
sem piscar, sem botão. A BrasilAPI é base de CNPJ; perguntar por CPF devolveria uma recusa que não
significa nada, na tela de quem não errou nada.

⚠ **A consulta é AJUDA, nunca PORTÃO.** Nenhuma função devolve impedimento; falha de rede ou CNPJ
não encontrado não bloqueiam a emissão, e a recusa vem acompanhada de "a emissão segue normalmente".
⚠ Essa frase mora na TELA e o FATO mora em `brasilApi.js` — dividido assim em 19/08 porque as duas
metades apareciam uma embaixo da outra, e quem apagasse uma não saberia qual carregava o "segue
normalmente". Não reintroduza a instrução no `brasilApi.js`.

⚠ **O `cMun` entra por PROVA TRIPLA, nunca por confiança** (`codigoMunicipioVerificado`, `:124`):
7 dígitos + existe na lista oficial versionada + município **e** UF daquela linha batem com o
`municipio`/`uf` da MESMA resposta. O nome do campo na BrasilAPI não está confirmado por
documentação oficial neste repositório — é exatamente por isso que a aceitação é por verificação.
Falhou qualquer prova: `null` com motivo, e o endereço inteiro deixa de ser oferecido.

⚠ **Endereço é TUDO OU NADA** (`enderecoDaReceita`, `:161`). O validador do backend só aceita o
bloco completo (`cMun`, `CEP`, `xLgr`, `nro`, `xBairro`; `xCpl` é o único opcional) e descarta o
resto em silêncio, e o formulário marca os cinco como obrigatórios — preencher quatro dos cinco
transformaria uma consulta bem-sucedida em bloqueio da emissão.

⚠⚠ **O `"RUA"` sozinho passava por logradouro** (`:173`, commit `13f6f4f9`). Enquanto o campo era
`[tipo, logradouro].filter(Boolean).join(" ")`, uma resposta com
`descricao_tipo_de_logradouro: "RUA"` e `logradouro` vazio produzia a string **"RUA"** — não-vazia,
portanto **aprovada** pela checagem de tudo-ou-nada logo abaixo. Meio campo passando por inteiro, na
exata regra que existe para impedir isso: o endereço inteiro entrava no formulário com a palavra
"Rua" no lugar da rua, e ia para o XML. Hoje: sem `logradouro`, `xLgr` fica vazio e o bloco todo é
recusado.

⚠ **O que veio da API é SUGESTÃO; quem digitou manda** (`aplicarNome`/`aplicarEndereco`), e a tela
mostra a origem no rótulo.

### Município — `SeletorMunicipio.jsx` + `lib/municipios/municipioIbge.js`

⚠ **Não se converte NOME em código.** Há cinco "Bom Jesus" e cinco "São Domingos" no país; o erro
aparece só como nota emitida no município errado. A busca mostra as linhas da tabela oficial (5.571,
medidas) e **a escolha é de quem lê**: nada vem pré-selecionado, resultado único **não** se
autosseleciona, `Enter` sem item marcado não elege ninguém, e toda opção mostra município **e** UF.

### ⚠⚠ O código de serviço — `lib/codigoServicoDaNota.js`

**A autoridade é o backend** (`apps/api/src/application/nfse/codigoServicoDaNota.js`,
`escolherCodigoServicoNacional`). Este módulo é ESPELHO, e o teste do cliente **importa a função do
backend** e roda os mesmos cenários pelas duas implementações — senão "espelho" é intenção, não
fato.

Três ramos (`SITUACAO`):
- `SEM_CODIGO` — diz que não recebeu.
- `UNICO` — **o ramo que renderiza hoje**: medido na entrega (`57366057`), 33 de 33 empresas.
  ⚠ **Não manda o campo no payload** (`codigoParaOPayload`, `:99`): sem ele o servidor usa o
  cadastro, que é o caminho testado de sempre.
- `VARIOS` — seletor, **sem pré-seleção**.

⚠⚠ **A TELA NÃO ELEGE.** Com vários códigos e nenhum escolhido, o campo não era enviado e o servidor
caía no singular: a empresa que habilitou três serviços emitiria sob o primeiro **em silêncio** —
erro fiscal silencioso, que o backend descreve como pior que a ausência do seletor. Hoje
`conferirCodigoEscolhido` (`:109`) recusa o submit antes de sair e a tela diz o que falta.

⚠ **Forma, nunca conteúdo:** 6 dígitos, `length !== 6`, **sem `padStart`**. Padding fabricaria
código plausível a partir de um dígito a menos — a classe do `cLocEmi="0000000"`.
⚠ Código gravado fora da forma **não some**: aparece como INVÁLIDO (a coluna não tem CHECK no banco).

### A carga tributária do Presumido — `lib/cargaTributaria.js`

Os três percentuais da Lei 12.741/2012 viajam até o cliente (dono, 19/08: *"o portal do cliente deve
enxergar sim, no caso do presumido"*) porque saem **impressos ao tomador** na nota que ele mesmo
emite.

⚠⚠ **A tela MOSTRA; ela não MANDA.** `NfseService` resolve por campo, **payload → cadastro**, e o
payload VENCE — se esta tela passasse a enviá-los, um valor velho preso no formulário sobrescreveria
em silêncio a correção que o contador acabou de fazer. Há teste que submete o formulário e recusa
`pTotTribFed/Est/Mun` no JSON inteiro.

⚠ Três estados, e o terceiro não é "falta": `NAO_RECEBIDA` (a resposta não trouxe as chaves — fato
sobre a RESPOSTA) × `COMPLETA` × `PENDENTE`. `null` gravado ≠ chave ausente, distinguidos por
`hasOwnProperty`. Faltando algum, o espelho mostra **traço**, nunca `0,00%`.
⚠ `pTotTribMun` **não é a alíquota de ISS** — na NFS-e real versionada do projeto o ISS é 5,00% e o
`pTotTribMun` é 0,00%, no mesmo documento.

### A descrição

Duas fontes, e nenhuma inventa texto de documento fiscal:

- **`lib/descricaoSugerida.js`** — a partir de `Company.atividades` (medido em produção:
  33/33 empresas preenchidas, contra `codigosServicoNacional` em 2/33 — uma sugestão que só serve a
  2 de 33 não facilita nada). ⚠ **Código nu não vira texto**: não existe tabela CNAE→descrição neste
  repositório. ⚠ Dois ramos, por gramática: descrição que já começa com "Serviço(s)" perde o
  prefixo; qualquer outra recebe `"Serviço prestado: "` — os **dois pontos** introduzem aposição, que
  aceita qualquer sintagma nominal (inclusive nome de agente no plural) sem exigir regência.
- **`lib/descricoesRecentes.js`** — só o que **este navegador** já emitiu, e o rótulo na tela diz
  isso. ⚠ Medido: nem `PortalInvoice` nem `ServiceInvoice` tinham coluna de descrição, e o detalhe
  devolve `items: []` cravado — o histórico do servidor não sabe o que foi descrito. Escopo por
  `companyId`; some no `logout` (`AppShell.jsx:120`), porque guarda nome e CNPJ de tomadores.

### O desfecho — `lib/desfechoEmissao.js`

| camada | HTTP | o que houve | e daí |
|---|---|---|---|
| `NOSSA` | 400 | recusamos antes de enviar | corrija e envie de novo |
| `TRANSPORTE` | 502 | o pedido saiu, desfecho **desconhecido** | ⚠ **NÃO reenvie** |
| `RECEITA` | 422 | o sistema nacional analisou e recusou | corrija e emita de novo |

⚠⚠ A linha do meio é a razão do arquivo existir: reemitir pode gerar duplicidade (**E0014**) e
**não existe inutilização na NFS-e** — número queimado é buraco permanente. Nesse ramo a tela não
oferece botão nenhum de reenvio: **não um botão com aviso, nenhum botão**.
⚠ `nfse_numero_em_estado_indeterminado` (409) é da FAMÍLIA do transporte, não erro de validação.

## O LOTE POR PLANILHA (`src/features/lote/`) — confere e, no fim, EMITE

> Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche; se o CNPJ
> preenchido for de um tomador que já teve antes, só preencher; se não teve consultamos na API; e se
> a API não retornar nós avisamos isso em uma tela para ajuste daquela nota; ajustando, ele passa
> por todas as notas para conferir e pode emitir em lote."*

⚠⚠ **ESTE BLOCO DIZIA "NÃO HÁ BOTÃO DE EMITIR". ELE EXISTE DESDE 20/08/2026**, e a frase ficou
falsa — corrigida aqui, porque a frase que descreve um comportamento é parte do comportamento.

### ⚠⚠ A PLANILHA TEM QUATRO COLUNAS — eram DOZE até 20/08/2026

> Dono (20/08/2026): *"não precisamos de nada do tomador, apenas o CNPJ ou CPF. Em caso que precise
> de mais informações, na hora da revisão nós avisamos e permitimos o preenchimento. Outra coisa:
> código do IBGE é abstração, deve apenas colocar o município (…). Retire o campo de atividade — o
> cliente não sabe escolher isso."*

**As quatro:** `documento` · `descricao` · `valor` · `competencia`. **Todas obrigatórias.**
O critério é de quem PREENCHE: quanto menos colunas, mais gente consegue usar.

⚠⚠ **AS SETE QUE SAÍRAM NÃO SUMIRAM DO FLUXO — MUDARAM DE LUGAR.** `nome`, `email` e o bloco de
endereço continuam existindo como CAMPOS (`CAMPOS_DA_REVISAO`, no backend e no espelho
`lib/colunasDoLote.js`), e o classificador continua lendo cada um. O que mudou é **por onde
entram**, nesta ordem: **cadastro de tomador** (`tomadores_emitidos`) → **consulta à Receita**
(só CNPJ) → **a tela de revisão**.

⚠ **SÃO DUAS LISTAS, E CONFUNDI-LAS É O DEFEITO.** `COLUNAS_DO_LOTE` responde *"o que o cabeçalho
da planilha pode conter?"*; `CAMPOS_DA_REVISAO` responde *"que célula uma pessoa pode corrigir?"*.
Montar o formulário de ajuste com a primeira deixa a pessoa sem como corrigir o que a pendência
pede; validar o ajuste com ela faz o servidor recusar (`ajuste_coluna_desconhecida`) exatamente os
campos que a revisão existe para preencher.

⚠⚠ **O NOME É OBRIGATÓRIO NO VALIDADOR (`tomador_nome_obrigatorio`) E MESMO ASSIM SAIU DA
PLANILHA.** Ele ganhou três origens e `origemNome` viaja com a linha (a tela mostra "nome de uma
nota já emitida" × "razão social vinda da Receita"; o que a pessoa escreveu não ganha rótulo,
porque a linha já diz "ajustada aqui"). ⚠ A regra antiga — *"a razão social da consulta NÃO
preenche um nome em branco, porque branco é branco"* — **caiu junto com a coluna**: ela existia
porque o nome era coluna obrigatória, e hoje branco é o estado normal.

⚠⚠ **CPF QUE NUNCA RECEBEU NOTA CAI SEMPRE NA REVISÃO, E ISSO É A REGRA — NÃO UM BURACO.** CPF não
se consulta; sem cadastro de tomador não existe origem nenhuma para o nome nem para o endereço, e as
DUAS faltas voltam nomeadas. O mock planta o caso **e o contraponto** (um CPF que a memória conhece,
que sai `pronta`) — senão "CPF cai na revisão" se lê como regra do DOCUMENTO em vez de regra do
desconhecimento.

⚠ **CONSEQUÊNCIA ACEITA: mais linhas nascem em `CONFERIR`/`PENDENTE`.** `PRONTA` continua exigindo
tudo resolvido. É o desenho, não regressão — e a tela já mostra quantas estão prontas e quantas não.

⚠ **A planilha do modelo ANTIGO continua sendo LIDA** (as quatro colunas que importam são
reconhecidas) e as sete do tomador voltam nomeadas em `colunasIgnoradas`. Aceitá-las em silêncio
manteria viva uma segunda porta de entrada para o endereço, com memória e consulta sendo puladas.

#### ⚠⚠ O MUNICÍPIO SE ESCOLHE, NUNCA SE DIGITA — e nunca se deriva do nome

O dono está certo de que *"código do IBGE é abstração"*; ninguém sabe o de cabeça. **Mas converter
nome em código erra em homônimo**: medido na lista oficial, **240 nomes cobrem 521 municípios**
(cinco "Bom Jesus", cinco "São Domingos"), e o erro aparece só como nota emitida no município
errado — que não se corrige, se cancela.

A resposta não é resolver texto: é **reusar `features/emitir/SeletorMunicipio.jsx`** no formulário de
revisão. Ele já busca por nome, mostra município **e UF** em toda opção, **não autosseleciona nem
com resultado único**, e devolve o código junto da escolha.
⚠ **Não escreva um segundo seletor** — duas implementações da mesma escolha divergem na primeira
correção, e esta decide em que município a nota é emitida.
⚠⚠ **E o campo NÃO TEM PADRÃO.** Dono: *"o município do tomador só deve ser preenchido pelo cliente
se a consulta do CNPJ não retornar"*. Pré-preenchê-lo com a cidade da empresa faria toda nota para
tomador de fora sair com a cidade errada **e parecendo conferida** — valor escolhido pelo sistema
fica indistinguível de valor conferido por uma pessoa.

#### O código de serviço (atividade) — nunca houve coluna, e continua não havendo

⚠ **A tela agora DIZ qual serviço as notas levam** (`CodigoDeServicoDoLote`), reusando o espelho
`emitir/lib/codigoServicoDaNota.js`. O lote **não manda o campo**: quem decide é o cadastro
(`escolherCodigoServicoNacional`), o caminho testado de sempre.
⚠⚠ **A TELA NÃO ELEGE.** Com vários códigos cadastrados (medido: **0 de 33 empresas**) ela **não
escolhe o primeiro** — seria o sistema decidindo qual serviço a empresa declara ao fisco. Ela nomeia
os cadastrados e diz quem decide. **A troca POR NOTA dentro do lote não foi construída**, e é
decisão a levar ao dono: ela exige o código viajar no payload congelado de cada linha
(`emissaoLote.js`), que é ato fiscal em série.

O que protege quem clica:

- a **CONFIRMAÇÃO é esta tela**, que já mostra linha a linha. O bloco final confirma o que ela
  mostra: quantas, o total e que é definitivo. ⚠ **Um bloco, não 50** — confirmação repetida ensina
  a clicar sem ler, e confirmação que ninguém lê é pior que nenhuma;
- ⚠ o primeiro clique **não emite**: abre a confirmação. Há teste medindo que a API não foi chamada;
- ⚠⚠ o que vai para a API é o **ARQUIVO**, nunca a lista de linhas — o servidor **reclassifica tudo**
  e decide o que é `pronta`. A tela não escolhe o que se emite;
- ⚠⚠ parando por **desfecho desconhecido**, a tela GRITA a linha (com o número reservado) e **não
  oferece retentativa dela** — nem com aviso. "Retomar" cobre só as seguintes, e a **ressalva vem
  antes do botão**, porque "retomar" se lê como "resolver tudo".

⚠ `indeterminada` é **âmbar, nunca vermelho**, e o rótulo é *"Desfecho desconhecido"* — nunca
"falhou". Vermelho e "falhou" convidam a tentar de novo, que é exatamente como se duplica nota.
Regras em `lib/emissaoDoLote.js` (43 testes).

### ⚠⚠ O LOTE RECONHECIDO — a frase FALSA, e a saída que não existia (21/08/2026)

> Caso real: lote de 3 notas RECUSADO pela Receita por erro de esquema (`E1235`). O erro do XML foi
> consertado e está em produção. O dono subiu a mesma planilha e leu:
> *"Esta planilha já havia sido emitida. (…) nenhuma nota nova foi emitida agora."* — com
> **Emitidas 0 · Recusadas 3**. Foi essa frase que o fez achar que o erro tinha voltado.

- ⚠⚠ **A FRASE ERA CRAVADA E AFIRMAVA O CONTRÁRIO DO RELATÓRIO LOGO ABAIXO.** Hoje ela é DERIVADA
  das linhas (`textoDoReconhecimento`): zero emitidas diz *"naquela vez NENHUMA nota foi emitida"*;
  parcial diz *"2 de 3 linhas viraram nota"*; tudo emitido diz que as notas foram emitidas. Se um
  dia o texto e o relatório discordarem, é porque alguém escreveu um texto fixo aqui de novo.
- ⚠⚠ **A RETENTATIVA É OFERECIDA** (`conviteParaRetentar`), e o que ela reemite é decidido **por
  LINHA, no servidor**: só o desfecho que PROVA que não existe nota (`recusada_receita`,
  `recusada_nossa`, `nao_tentada`). ⚠⚠ `emitida` e `indeterminada` **NUNCA**. A regra vive em
  `apps/api/.../lote/emissaoLote.js` e este módulo é **ESPELHO amarrado por teste** — o teste
  importa `podeRetentar` do backend e exige o mesmo veredito nos mesmos casos.
- ⚠⚠ **O CASO PARCIAL:** lote com 2 emitidas e 1 recusada reemite **uma**. A `ressalva` vem ANTES
  do botão (molde da de `conviteParaRetomar`) e nomeia quantas ficam de fora e por quê — "tentar de
  novo" se lê como "refazer o lote", e refazer o lote reemitiria nota que já existe.
  ⚠ **Sem nada bloqueado não há ressalva**: não existe mal-entendido a desfazer, e o critério do
  dono manda cortar a frase que só descreve uma ausência já visível.
- ⚠ **Âmbar, nunca verde** — é PENDÊNCIA. Verde, nesta casa, é concluído e nunca ação.
- ⚠ A tela **não escolhe linha nenhuma**: `api.retentarLoteEmissao(companyId, loteId)` não manda
  lista. Reenviar o ARQUIVO cairia na impressão digital e não emitiria nada.
- ⚠⚠ **O RELATÓRIO PASSOU A DIZER QUANDO** — coluna "Quando", por linha, de `tentadaEm` (carimbo
  que já existia no registro e não viajava). *"Recusada pela Receita"* sem hora é ambíguo assim que
  existe uma segunda tentativa, e um resultado das 11:41 foi lido como sendo das 12:41. ⚠ Linha
  `nao_tentada` sai com **traço** — pôr a data do LOTE ali carimbaria uma tentativa que nunca houve.
  O carimbo do lote aparece à parte, **dizendo que é do lote** ("Lote enviado em …").
- ⚠ `fmtDataHora` (`lib/format.js`) é a **exceção deliberada** à regra de `fmtDateBr`, que evita
  `new Date` para não deslocar fuso: ali o dado é data CIVIL (sem hora); aqui é um INSTANTE gravado
  em UTC, e o que a pessoa precisa ler é o relógio dela.

Contrato (LIDO de `apps/api/src/routes/nfseLoteRoutes.js`): `GET .../nfse/lote/modelo` (o .xlsx) e
`POST .../nfse/lote/leitura` (multipart: `arquivo` + `consultas` + `ajustes`). ⚠ O modelo vem por
**Blob**, com Bearer — `<a href>` receberia 401.

### ⚠⚠ A CLASSIFICAÇÃO É DO BACKEND. A TELA MOSTRA — com DUAS exceções, as duas delegadas por escrito

Os quatro estados são lista FECHADA (`classificarLinhaLote.js`): `pronta` · `conferir` ·
`consultar` · `pendente`. `lib/estadoDaLinhaDoLote.js` é ESPELHO, amarrado por teste que importa o
`ESTADO` do backend. As duas coisas que esta tela DECIDE são as que o servidor não tem como fazer:

1. ⚠⚠ **A CONFERÊNCIA DO CÓDIGO DO MUNICÍPIO — e esta exceção CAIU em 20/08/2026.** O `apps/api`
   passou a ler a lista de `packages/shared` e **refaz a prova tripla por conta própria**;
   `cMunVerificado` **não é mais lido pelo servidor**. Por isso `consultasDoLote.js` passou a enviar
   `municipio`/`uf` CRUS — e, desde 20/08/2026, a **razão social** também, porque o nome do tomador
   deixou de ser coluna e a Receita é uma das três origens dele. Sem `municipio`/`uf` a prova 3 não
   fecha e a linha é recusada (falha fechado). A tela
   continua conferindo para poder MOSTRAR, mas ela não é mais a autoridade. O backend marca
   `municipio_nao_conferido` e escreve, no próprio arquivo, que *"a conferência acontece na tela de
   ajuste, que tem a lista"*. **Cumprir a segunda metade é obrigação desta tela**: código que existe
   vira "Rio de Janeiro / RJ" na linha (município **e** UF, sempre); código que não existe **derruba
   a linha para `pendente`**, com o código de pendência **do próprio backend**
   (`municipio_inexistente`) — o veredito que ele daria se tivesse a lista.
   ⚠ O texto do backend é **substituído** quando a conferência acontece: ele dizia que ela ainda ia
   acontecer, e ficaria falso.
   ⚠ Sem código a conferir (linha já pendente por outro motivo volta com `dados: null`) **não se
   confere nada** — a primeira versão lia `""` e acusava `municipio_inexistente` com o código vazio,
   inventando um segundo defeito em três linhas do mock.
2. ⚠⚠ **A CONSULTA DO CNPJ NA RECEITA** (`lib/consultasDoLote.js`), que sai do navegador. ⚠ **CPF
   NÃO SE CONSULTA** — a guarda é `decidirConsulta`, a MESMA da emissão avulsa, e há teste provando
   que nenhuma chamada sai. ⚠ `cMunVerificado: true` só nasce da **prova tripla** de
   `enderecoDaReceita`/`codigoMunicipioVerificado`; não existe caminho que o produza sem endereço, e
   o backend recusa `!== true`.

⚠⚠ **A TELA SÓ REBAIXA, NUNCA PROMOVE.** Nada aqui transforma `conferir`/`consultar`/`pendente` em
`pronta`. ⚠ E **estado que a tela não conhece não vira pronta**: sai nomeado, em vermelho, contado
fora das prontas. O "ainda não" é `total - prontas`, e não a soma dos outros três — um estado novo
no backend entra nessa conta **por construção**, em vez de sumir dela.

⚠ O **resumo é RECONTADO na tela**, e não o do servidor: ele não sabe da conferência do município, e
mostrá-lo ao lado das linhas rebaixadas faria a tela discordar de si mesma no número que decide se
dá para seguir. **Prontas e não-prontas ficam sempre à vista** (`data-lote="prontas"` /
`"nao-prontas"`, auditáveis no DOM).

### O segundo passe — parcial de propósito

A consulta é **em série** (200 linhas, BrasilAPI pública com throttle) e o mapa é **por documento**:
vinte linhas do mesmo CNPJ consomem uma consulta. Enquanto roda, a tela mostra o progresso e um
botão **"Parar e conferir o que já veio"**.

⚠⚠ **UMA CONSULTA QUE FALHA NÃO DERRUBA O LOTE**: ela vira pendência DAQUELA linha, com o motivo, e
as outras seguem. Exigir o conjunto completo travaria a tela esperando tudo — e é literalmente o que
o dono descreveu (*"se a API não retornar nós avisamos isso em uma tela para ajuste daquela nota"*).

### O ajuste — o que a pessoa digita, e o que ele NÃO é

O formulário abre com as células que vieram da planilha (o backend as devolve em `valores`, porque a
linha pendente tem `dados: null` e sem elas a tela não sabe de que nota fala). ⚠ **Só o que MUDOU é
enviado**, em `ajustes`, chaveado pelo **número da linha DO EXCEL** — o mesmo que a pessoa vê na
planilha dela. Índice de array iria para a nota errada.

⚠⚠ **A REGRA NÃO FOI REIMPLEMENTADA AQUI.** As alternativas foram medidas e recusadas: reimplementar
a classificação no front dá duas regras que divergem na primeira correção, e remontar o .xlsx no
navegador poria o **SheetJS** no bundle de um app que **não tem nenhuma dependência fora do React**.
O arquivo é reenviado a cada passe e quem classifica é sempre o servidor.

⚠⚠ **O AJUSTE VIVE NESTA TELA, E ISSO É DITO.** A planilha no disco continua com o valor antigo, e
subir o mesmo arquivo amanhã perde as correções. A frase fica porque é ausência que muda decisão.
⚠ Recusa de ajuste (`ajuste_coluna_desconhecida`, `ajuste_linha_desconhecida`,
`ajuste_forma_invalida`) **não descarta a leitura**: o servidor recusou a correção, não o arquivo.

⚠ **Trocar de arquivo descarta os AJUSTES e mantém as CONSULTAS**: o ajuste é chaveado pela linha (a
ordem pode mudar), a consulta pelo documento (que não muda de significado).
⚠ **Trocar de empresa descarta tudo** — planilha, ajustes e consultas —, na casca **e** dentro da
tela: guarda de um lado só não é guarda, e conferir a planilha de outra empresa prepararia notas no
CNPJ errado.

### O mock

⚠⚠ **ELE ALCANÇA TODOS OS ESTADOS DE LINHA**, e é a razão de ele decidir em vez de devolver uma
resposta fixa — este projeto foi mordido QUATRO vezes por ramo que só existia em produção. As linhas
plantadas cobrem `pronta` pela memória (⚠ e desde 20/08/2026 é dela que vêm também o NOME e o
e-mail), as três conferências (`municipio_nao_conferido`, `zero_a_esquerda_recuperado`,
`email_fora_de_forma`), a consulta que **resolve** (e que preenche a razão social), a que responde
sem endereço provável, a que **falha**, e `endereco_incompleto` / `valor_ambiguo` /
`competencia_ausente` — mais ⚠⚠ **`nome_ausente` + `cpf_sem_endereco` JUNTOS**, que é o CPF sem
cadastro, com o contraponto do CPF conhecido ao lado.
⚠ As linhas plantadas que trazem `nome`/endereço nas `valores` representam linhas **já revisadas** —
a planilha tem quatro colunas, e é assim que os ramos que dependem de endereço digitado (a
conferência do município, o tudo-ou-nada) continuam alcançáveis offline. ⚠ Inclusive **a linha que o servidor dá como `conferir` e a TELA rebaixa** —
sem ela, a segunda metade da prova do IBGE seria inalcançável offline.
As recusas da leitura têm gatilho no **nome do arquivo** (`#cabecalho`, `#vazia`, `#colunas`), mesmo
arranjo das sentinelas da emissão. E o modelo do mock é um **.xlsx de verdade** (reusa o
`zipArmazenado` do lote de DANFSe), porque um arquivo corrompido com a extensão certa faria o modo
offline "funcionar" até alguém tentar abrir.

Testes: `lote/lib/__tests__/` (colunas 11 · estado 23 · consultas 15 · emissão 43 · recusa 9),
`lote/__tests__/lotePlanilhaNaTela.ligacao.test.jsx` (27 — a corrente inteira, com
`api.emitirNfse` armadilhado) e `api/__tests__/loteDePlanilhaNoMock.test.js` (36 — o par mock/real e
todos os estados).

⚠ **O rótulo do botão e do título é "Emissão em Lote"** — pedido do dono em 21/08/2026. Era
*"Preparar lote por planilha"*, de quando a tela ainda não emitia (ela emite desde 20/08/2026), e o
comentário em `NotasPage.jsx` explicava por que o rótulo não podia prometer emissão. Mudou só o
TEXTO: a chave de navegação, o handler e os `data-*` continuam os mesmos — o despacho deste app é
por cadeia de `if` com chave em string, e renomear a chave quebra em silêncio.

⚠ **A sentinela `#tudorecusado` no nome do arquivo** reproduz o caso real offline (todas recusadas
com `E1235`, zero emitidas). Sem ela, o ramo em que a tela oferece a retentativa só existiria em
produção — e este projeto já foi mordido quatro vezes por ramo assim.

## A LISTA DE NOTAS (`src/features/notas/`)

Lê `GET /client/companies/:id/invoices?direcao=emitidas`. O `summary` é do **filtro inteiro**
(agregado no backend), não da página — por isso vive fora da tabela.

### ⚠⚠ A união na leitura — a nota emitida aparece antes do ADN

Pedido do dono (19/08): a nota emitida deve aparecer na hora, e ficar "viva como as outras" quando o
ADN confirmar. O sintoma medido: a lista lê **`PortalInvoice`** (projeção do ADN) e a emissão grava
**`ServiceInvoice`** — entre emitir e a próxima captura, a nota não existia para o cliente.

A regra é do backend: `apps/api/src/application/notas/notasEmitidasNaoConfirmadas.js`, consumida por
`routes/portalInvoices.js:349`; a tela recebe `confirmadaPeloAdn`.

⚠ **NÃO SE ESCREVE `PortalInvoice`.** Ela é a projeção de um sistema EXTERNO, com donos declarados
(`notas/ingestaoNfse.js`, "a única porta de entrada de NFS-e no banco", mais o motor legado). Uma
quarta escrita criaria linha que a captura não conhece — defeito já pago aqui: o import manual
gravava `chaveAcesso: null` fixo, o upsert nunca achava a linha e **o faturamento somava a nota duas
vezes**. Pior: a linha escrita à mão não teria o `xmlRaw`, de onde saem os campos fiscais, o DANFSe
e a numeração da próxima emissão. **Na leitura a duplicata é reversível; na escrita ela é permanente
e contamina o dinheiro.**

⚠⚠ **A dedup usa a TUPLA DO E0014 — `(série, nDPS)`** — e ela IDENTIFICA por regra do sistema
nacional, não por convenção nossa: a RN E0014 rejeita DPS cujo conjunto *Série + Número + Município
Emissor + CNPJ* já exista, e o escopo (`PortalClient.companyId` `@unique` ↔ `Company.cnpj` `@unique`)
já fixa os dois últimos. São literalmente os mesmos números que `buildDpsXml` escreve e que o
nacional devolve dentro da NFS-e. Provas complementares: `chaveAcesso` e `numeroNfse`.
⚠ **Ausência nunca vira igualdade** — cada prova só é aplicada quando os DOIS lados têm o valor.
⚠ Só `papel: "EMIT"` do outro lado: a numeração de uma nota recebida é do prestador dela.

### ⚠⚠ O CHIP LÊ O `ciclo`, NÃO SÓ O `status` — `lib/chipDaNota.js` (24/08/2026)

Uma nota SUBSTITUÍDA aparecia como **"Cancelada"** aqui e **"Substituída"** na tela do contador.

`PortalInvoice.status` distingue as duas **quando o ADN mandou o evento**
(`InvoiceSyncEngine.mapInvoiceStatusFromAdn` traduz `E105102` em `SUBSTITUIDA`). Quando não mandou —
**556 NFS-e canceladas com ZERO eventos guardados**, medido em produção — quem sabe é `derivarCiclo`,
por uma evidência que o `status` não tem: *"existe, na base, outra nota que declara substituir esta"*
(22 notas em produção). O escritório já lia isso; o contrato do cliente não trazia.

⚠ O `ciclo` passou a viajar em `serializeInvoice`, com **`situacao` e `ehSubstituta` e mais nada** —
os `avisos`, o evento e as chaves do outro lado do vínculo nomeiam OUTRO documento, para o qual este
portal não tem tela.

⚠⚠ **A PRECEDÊNCIA É ESTREITA: o `ciclo` vence ao dizer `substituida`, e em mais nada.**
- **`autorizada` não apaga REJEITADA** — `derivarCiclo` chama de `autorizada` tudo que não está
  cancelado, **inclusive a nota que a Receita recusou**. "Emitida" ali faria quem emitiu concluir que
  tem nota fiscal onde não tem.
- `autorizada` não apaga PENDENTE.
- `cancelada` do ciclo não rebaixa um `status` SUBSTITUIDA: ali o `status` é o mais específico.
- ⚠ **AUSENTE NÃO É NADA**: sem `ciclo`, o comportamento é exatamente o de antes.

⚠⚠ **PENDÊNCIA MEDIDA, NÃO RESOLVIDA:** a rota esconde por padrão tudo com
`statusEfetivo: "cancelada"` e este portal **nunca manda `incluirCanceladas=1`**. `statusEfetivo` tem
dois escritores com critérios diferentes, então existe combinação em que a nota substituída aparece
(e o chip agora acerta) e combinação em que ela **não aparece de jeito nenhum** — o que também
tornaria o aviso `origem_substituida` do reaproveitamento inalcançável. Distinguir exige o banco.
**É pergunta ao dono: o cliente deve ver a nota substituída?** O filtro não foi afrouxado.

### ⚠⚠ Estado sem texto na tela — `lib/estadoDaLinhaDaNota.js`

Instrução literal do dono: ***"não coloque explicação disso na tela"***. Há teste varrendo o texto da
página contra as frases proibidas.

São TRÊS estados (`data-estado-nota` no `<tr>`; era um booleano `data-confirmada-adn`, e um booleano
não comporta três):

- `aguardando_adn` — emitida por nós, o ADN ainda não devolveu. **Mais clara** (`opacity: .62`,
  `app.css:142`); volta a 100% no `hover`/`focus-within`.
- `cancelamento_enviado` — acabamos de mandar cancelar. **Riscada** (`line-through`, `app.css:158`).
- `confirmada`.

⚠⚠ **Desenhos diferentes de propósito.** Os dois esperam o ADN, mas um espera confirmação de que a
nota EXISTE e o outro de que ela DEIXOU de valer — mesmo desenho para os dois é o defeito que a
distinção existe para impedir. O risco é fino e a opacidade fica cheia porque a pessoa ainda precisa
**conferir qual** nota mandou cancelar. O chip não muda de cor nem de rótulo, para não se confundir
com "cancelada".

⚠ O estado viaja em três canais: `data-estado-nota` (auditável no DOM), CSS, e `title`/`aria-label`
do chip — que **não são texto na tela** e são o que existe para quem usa leitor de tela.

### ⚠ Impedimento tem ESCOPO — `lib/impedimento.js`

A linha tem três ações (DANFSe, Cancelar, Usar como modelo) e várias chegam à MESMA conclusão sobre
a MESMA nota. Quando cada botão escrevia o próprio motivo, a linha dizia *"Ainda não confirmada."*
duas vezes, lado a lado.

- `ESCOPO.NOTA` — o fato é da NOTA; a linha já o carrega (coluna Tipo, chip, `title`). **Sem texto
  visível.**
- `ESCOPO.ACAO` — o fato é só deste botão (ex.: "sem o XML guardado", que só o DANFSe exige). **Com
  texto ao lado.**

⚠ O botão continua **desabilitado e com `title` nos dois casos** — "botão impossível não some e diz
por quê" não afrouxou, mudou de canal.

### DANFSe — `lib/danfseDaNota.js`

⚠ É o gêmeo de `apps/web/src/features/notas/lib/danfseDaNota.js` e **as perguntas divergem de
propósito**: o contrato do cliente (`serializeInvoice`) **não traz `chaveAcesso`** — traz `type` e
`hasXml`. Copiar a versão do escritório sem olhar faria `podeGerarDanfse` ler um campo que nunca
chega e desabilitar o botão em toda nota.
⚠ `confirmadaPeloAdn === false` desabilita: o id ali é um `ServiceInvoice.id` e a rota do DANFSe lê
`PortalInvoice` — ofereceria o botão para receber 404.
⚠ Recusa desconhecida **não ganha "tente de novo" fabricado**; a mensagem do servidor vence.

### ⚠⚠ O LOTE DE DANFSe TEM DOIS ESCOPOS — `lib/selecaoDeNotas.js` (28/08/2026)

Em 27/08/2026 o botão "Baixar DANFSe em lote" saiu e a seleção por linha entrou, a pedido do dono:
*"tire o botão de baixar em lote, deixe o usuário selecionar as notas que ele quer e abra a opção
baixar"*.

⚠⚠ **MAS O BOTÃO ANTIGO BAIXAVA ATÉ 200 NOTAS, E A PÁGINA MOSTRA 25.** A seleção por página,
sozinha, atende a letra do pedido e desfaz uma capacidade: quem tem 120 notas no mês passou a
conseguir baixar 25. **O pedido era sobre ESCOLHER, não sobre baixar menos.** Por isso os dois
escopos convivem — o cabeçalho marca a PÁGINA, e havendo mais notas no mês aparece a segunda
oferta, nomeada.

| | o que a tela sabe | o rótulo |
|---|---|---|
| **PÁGINA** | exatamente quais linhas geram DANFSe (`podeGerarDanfse` decide, e o que não gera nem pode ser marcado) | *"Baixar 3 DANFSe"* — promessa que se cumpre |
| **COMPETÊNCIA** | só o total do filtro; quem escolhe é o servidor, pelo MESMO `where` da listagem | *"Baixar os DANFSe destas 70 notas"* |

⚠⚠ **NA COMPETÊNCIA O NÚMERO É DE NOTAS, NUNCA DE DANFSe** — ali entram notas que não geram PDF
(NF-e, nota ainda não confirmada pelo ADN, nota sem o XML guardado). Elas saem NOMEADAS no
`RELATORIO.txt`, mas prometer *"Baixar 70 DANFSe"* e entregar 63 é o defeito que a barra inteira
existe para não cometer. A frase que diz isso é **obrigatória** neste escopo — e **proibida** no
outro, onde não há nada a ressalvar (legenda que descreve uma ausência foi cortada pelo dono).
Medido no navegador em 12/2025: página com 25 linhas e **22** marcáveis, contra **70** no total.

⚠⚠ **É A AUSÊNCIA DOS IDS QUE ABRE O FILTRO INTEIRO**, e não um parâmetro novo: `pedidoDoLote`
manda `{competencia}` sem `ids` no escopo largo, e a rota (que já os põe no `AND` do `where`) cai no
comportamento antigo. Mandar os 70 ids exigiria buscar todas as páginas só para remontar o que o
`where` já sabe, e a lista poderia envelhecer entre a busca e o clique.

- ⚠ **A oferta só aparece com MAIS notas do que a página mostra.** Com tudo numa página, o cabeçalho
  já faz o mesmo, e uma segunda porta para o mesmo ato ensina a não ler a barra.
- ⚠ **Acima do teto ela aparece DESABILITADA, com o motivo E a saída** — verificado no navegador em
  11/2025 (215 notas): *"São 215 notas, e o lote gera no máximo 200 por vez. Escolha uma competência
  mais estreita, ou marque as notas página a página."* Botão que some esconde que a ação existe; o
  servidor recusaria com `lote_muito_grande` de qualquer jeito, e descobrir isso depois de clicar é
  pior do que ler antes.
- ⚠⚠ **TROCAR DE EMPRESA OU DE COMPETÊNCIA DESLIGA O ESCOPO LARGO.** Ele afirma "todas as notas
  DESTE mês", e a poda da seleção **não o alcança** — não há id nenhum para podar. Sem o reset, o
  clique seguinte baixaria o mês que ninguém escolheu.
- ⚠ **Ligar o escopo largo limpa as marcações**, e "Limpar seleção" desliga os dois: dois números na
  tela para o mesmo lote é o que faz a pessoa conferir o zip contra o rótulo errado.
- ⚠ **`ESCOPO_DO_LOTE`, e não `ESCOPO`** — este último já existe na feature (`lib/impedimento.js`,
  NOTA × AÇÃO) e a `NotasPage` importa os dois. O nome colidiu no build; duas constantes homônimas
  em arquivos diferentes compilariam e confundiriam, que é pior.
- ⚠ **Escopo desconhecido cai na PÁGINA**, o estreito: baixar de menos se conserta com um clique;
  baixar o histórico inteiro gera um zip que ninguém pediu.
- ⚠⚠ **`Number.isFinite(Number(null))` é `true`** — a primeira versão da guarda de contagem usava
  isso e deixava passar `notasNaPagina: null`, comparando 70 contra "zero na página". Foi o TESTE
  que pegou. Hoje as duas contagens têm de ser `typeof === "number"`.

⚠ **`LOTE_MAXIMO` mudou de lugar**: era cópia dentro do `mockApi`, e passou para
`features/notas/lib/loteDanfse.js` — a TELA passou a precisar dele (para desabilitar a oferta com o
motivo), e duas cópias dentro do MESMO app é como o mock e a tela começam a discordar. O mock agora
o importa. ⚠ Ele continua sendo **espelho** de `apps/api/.../loteDanfseDoPortal.js`: mudou lá, muda
aqui.

⚠ **A doc de `realApi.baixarDanfseEmLote` dizia "NENHUMA LISTA DE IDS VAI DAQUI"** com o código três
linhas abaixo já mandando `ids` desde 27/08/2026. Corrigida — e o argumento antigo ficou escrito,
porque é ele que explica por que a competência continua viajando nos dois escopos.

⚠⚠ **O MOCK GANHOU O RAMO QUE FALTAVA.** Ele já tinha uma competência ACIMA do teto (205 notas, para
a recusa `lote_muito_grande` ser alcançável offline) e **nenhuma no meio** — então o desenho da
oferta HABILITADA só existiria em produção. Entraram 60 notas numa segunda competência, uma em cada
dez **sem XML**, que é o que mantém `total ≠ DANFSe` visível offline. Quinta vez que o mock esconde
um ramo nesta base.

Testes: `lib/__tests__/selecaoDeNotas.test.js` (16) + os oito casos novos em
`__tests__/loteDanfseNaTela.ligacao.test.jsx`. **Experimentos executados:** tirando a oferta da
tela, **6 vermelhos**; a competência voltando a mandar os ids, **2**; o rótulo largo prometendo
DANFSe, **4**.

### Cancelamento — `lib/cancelamentoNota.js`

Decisão do dono (19/08): *"esqueça substituir então, deixe apenas o cancelar."*

⚠⚠ **A lista de motivos é FECHADA e é do LEIAUTE**, não escolha de produto: `tiposEventos_v1.01.xsd:233`
declara `<cMotivo type="TSCodJustCanc">` e `tiposSimples_v1.01.xsd:219` enumera **"1", "2", "9"**
(um caractere). ⚠ **Não confundir com `01…05, 99`** — aquela é a `TSCodJustSubst`, da substituição.
Mandar `"01"` num cancelamento é falha de schema.

⚠ `xMotivo`/justificativa: **mín. 15, máx. 255** (`TSMotivo`, `tiposSimples_v1.01.xsd:348`), e o
mínimo aparece **antes** de a pessoa digitar — descobri-lo ao clicar em "Cancelar", num ato
irreversível, é o pior momento possível.

⚠⚠ **Camada TRANSPORTE desabilita o botão** (`podeTentarDeNovo: false`, `:166`): o pedido saiu e a
resposta não voltou; a nota **pode** estar cancelada. Um segundo pedido volta recusado pelo sistema
nacional e se lê como "falhou", quando o primeiro tinha dado certo. Pela mesma razão existe a guarda
`cancelamentoEnviado` (`:63`) — o servidor ainda responde "EMITIDA" porque a lista lê `PortalInvoice`.
⚠ `corpo.podeTentarDeNovo !== false`, não `?? true`: ausência do campo não pode desabilitar o botão
para sempre, mas `false` explícito tem de desabilitar.

### Reaproveitar ("Usar como modelo") — `src/features/emitir/lib/reaproveitarNota.js`

⚠⚠ **Identificador NUNCA é copiado**: `numero`, `chaveAcesso`, `idNfse`, `idDps`, série/RPS, a
competência da origem, status, ciclo e eventos. Copiar qualquer um produz (a) duplicidade — a
rejeição **E0014** — ou (b) uma nota que se apresenta como sendo outra. O número da nova é reservado
pelo BACKEND, em transação, no instante da emissão. ⚠ A invariante é testada **por varredura do
objeto**, não campo a campo: um teste que só olhasse os campos conhecidos deixaria passar alguém
acrescentando `chaveAcesso` "só para a tela mostrar".

⚠⚠ **O VALOR: duas decisões do dono, e a segunda desfez a primeira.**
- **18/08** — sai **vazio**: *"…apenas apagando o valor — isso deveria ser possível."*
  `formatarValorParaCampo` chegou a ser **proibida por escrito** neste arquivo.
- **19/08** — é **copiado**: ele pediu a nota *"100% idêntica"*; perguntado qual pedido valia,
  respondeu **`"copia"`**. A razão própria: entre reaproveitar e emitir há uma tela inteira de
  conferência, e na prática o valor SE REPETE (serviço recorrente). Isso também **alinha os dois
  portais** — o `reaproveitarNota.js` do escritório sempre copiou.

⚠ Quem ler daqui a seis meses precisa saber que houve DUAS decisões, senão a primeira volta
"consertando" a segunda. ⚠ E copiar o valor **não abre a porta para copiar o resto**.
⚠ Nota sem total abre o campo **vazio**, nunca `0,00`, e o aviso muda de código junto
(`valor_copiado` × `valor_em_branco`) — um aviso fixo mentiria num dos dois ramos.

⚠⚠ **A DECISÃO DE 19/08 DEIXOU RASTRO FALSO EM TRÊS LUGARES, LIMPOS EM 24/08/2026** — o cabeçalho do
módulo, o comentário de `podeReaproveitar` e **uma frase da TELA** (*"Não guardamos o tomador desta
nota — e o valor não é copiado"*) continuaram descrevendo o comportamento de 18/08. A tela
contradizia a si mesma sobre o mesmo campo, porque três funções abaixo o aviso `valor_copiado` diz
que o valor FOI copiado.
- ⚠ **E a guarda ficou de pé sobre o fato morto:** `podeReaproveitar` barrava nota sem tomador
  **mesmo com total**, enquanto o escritório a aceita (`!temTomador && !temValor`). A MESMA nota
  abria lá e era recusada aqui. Alinhado. ⚠ O critério não afrouxou: **nada a copiar continua
  barrando**, e total ZERO não conta como valor.
- ⚠ O teste que travava o comportamento antigo levava a premissa morta escrita no próprio
  comentário, e ficava verde porque media a guarda — **as duas concordavam entre si sobre um fato já
  falso**. Isto não é o mesmo que reabrir decisão do dono (ver a legenda da alíquota em
  `EmitirNotaPage`): ali havia decisão; aqui havia um raciocínio técnico cuja base deixou de existir.

⚠ **Nota cancelada e nota substituída PODEM ser modelo** (a nota errada é o melhor modelo para a
certa): copiar não é reemitir, a original não é tocada e nenhum evento é gerado. O que não se pode é
a tela calar — a permissão vem sempre com o aviso de que isto não corrige nem substitui a origem.

⚠ **Nota recebida é reconhecida pelo CNPJ, não pelo `papel`**: `papel: "DEST"` existe no portal do
escritório e **não vem** no contrato do cliente. Cinturão que depende de campo inexistente não segura
nada.

⚠ A descrição **passou a chegar** em 19/08 (`1958a3de`), de **coluna** (`PortalInvoice.xDescServ`,
escrita por caminho `.../serv/cServ/xDescServ`, NT 008 §2.4.5) — **nada é parseado na listagem**. A
regra do item único continua intocada: mais de um item ⇒ descrição vazia com aviso, porque emendar
dois itens com " · " escreveria na nota nova uma frase que ninguém redigiu, e ela sai impressa no
DANFSe do tomador.

⚠⚠ **O defeito latente que essa mudança acendeu:** o efeito do MODELO escreve a descrição e marca
`descricaoDigitada`; o efeito da SUGESTÃO roda no mesmo commit, depois, e lia aquele estado pelo
closure do render anterior — ainda `false` — sobrescrevendo a descrição da nota com a sugestão do
cadastro. Era latente desde antes: enquanto `modelo.campos.descricao` era sempre `""`, a sobrescrita
era no-op. **Quem acendeu foi o teste de LIGAÇÃO, não o de regra** — a regra devolvia a descrição
certa o tempo todo, e passaria com a tela mostrando campo vazio para sempre.

⚠ **Trocar de empresa descarta o modelo** (`AppShell.jsx:69`) e a `EmitirNotaPage` **confere o
`companyId`** antes de aplicar: aplicar numa empresa o modelo tirado da nota de outra emitiria no
CNPJ errado — o pior desfecho possível num portal multi-empresa, e irreversível.

⚠ **As listas `CAMPOS_COPIADOS`/`CAMPOS_NAO_COPIADOS` do escritório NÃO existem aqui**: lá elas SÃO
o texto da tela; aqui seriam doze linhas novas na tela que o dono pediu para encolher. Lista que
ninguém renderiza é código morto.

## GUIAS (`src/features/guias/`) — `lib/linhaDigitavelTela.js`

Três ausências com significados diferentes, que não podem ser desenhadas iguais: `NAO_TENTADA`
(ninguém olhou o documento), `NAO_ENCONTRADA` (olhamos e não há linha legível), `DIVERGENTE` (lemos
uma linha íntegra que discorda do valor da guia).

⚠ **A diferença em relação ao portal do contador é deliberada: o cliente NÃO vê os dois valores da
divergência.** Os dois números são material de TRABALHO do contador; mostrá-los ao cliente entregaria
um problema sem entregar a ação, com dois valores em conflito numa tela cujo assunto é "quanto eu
pago". ⚠ Nos três casos o "Baixar PDF" continua sendo a saída — ausência de linha nunca vira ausência
de caminho para pagar.

## ⚠⚠ A DARF DO LUCRO PRESUMIDO SE CHAMAVA "OUTRA" NA TELA DO CLIENTE (24/08/2026)

> Dono: *"as guias do lucro presumido do PIS e COFINS não estão aparecendo no portal do cliente"*.

**Eram DOIS defeitos empilhados, e só um é nosso.**

**1 · O rótulo — defeito, consertado.** A coluna "Tipo" imprimia `texto(guia.tipo)` cru, e **a DARF
consolidada do LP é gravada como `tipo: "OUTRA"`** — um documento só, com até quatro tributos
dentro (PIS, COFINS, IRPJ, CSLL, e às vezes IRRF). O cliente do Presumido lia literalmente
**"OUTRA"**, sem nenhuma menção a PIS ou COFINS.

⚠ **O DADO SEMPRE CHEGOU.** `toGuideResponse` já mandava `extracted.composicao`; medido em
produção, **9 de 9** DARFs de LP têm a composição gravada. Não faltava captura, coluna nem rota —
faltava a LEITURA. Mesma classe do `codigosServicoNacional`: o campo viaja e ninguém o lê.

Regra em **`features/guias/lib/rotuloGuia.js`**, **espelho** de `rotuloTipoGuia`
(`apps/web/src/features/guides/lib/rotuloGuia.js`), **amarrado por teste**: o teste importa a
função do outro portal e exige o mesmo veredito em 12 casos. Sem o amarre, "espelho" é intenção e
não fato — e a divergência apareceria como o contador vendo "PIS · COFINS" e o cliente vendo
"OUTRA" sobre a MESMA guia, que é o estado que este conserto desfaz. Entra na tabela
"mudou lá, muda aqui".

- ⚠ **SEM composição o rótulo continua "OUTRA", e é a resposta certa.** "OUTRA" é o que está
  GRAVADO; inventar "PIS · COFINS" numa guia cuja composição não foi lida afirmaria ao cliente
  quais impostos ele está pagando sem ninguém ter medido.
- ⚠ **O ramo do PARCELAMENTO não é espelho, de propósito** — lá o rótulo é montado no front, aqui
  o backend manda `parcelamentoLabel` pronto, e era assim antes. O que fica travado é a
  **precedência**: parcelamento decide ANTES do tipo, senão a parcela (gravada como
  `tipo: "SIMPLES"`, idêntica ao DAS) apareceria como o DAS.
- O `title` da célula passou a levar o detalhamento por tributo **com valor** — sai da mesma
  `composicao`, nenhum número novo é calculado. É o documento que o cliente vai pagar.

**2 · A INVISIBILIDADE — não é defeito, é a regra.** Medido em produção: **8 das 9** DARFs de LP
estão com **`liberadaCliente: false`**. A rota já responde com `apenasLiberadas: true` (o cliente
só vê o que o contador liberou) e o download refaz a checagem. Enquanto o contador não clicar em
"Liberar ao cliente", elas não aparecem — com ou sem este conserto. **Não afrouxe esse gate.**

Medição (só leitura, zero chamada externa): `apps/api/scripts/diag-guias-lp-portal-cliente.mjs`.

---

## ⚠⚠ A SITUAÇÃO FISCAL (`src/features/fiscal/`) — 21/08/2026

> Dono: *"um símbolo de situação fiscal, onde mostraremos a tabela da situação fiscal ao cliente"*.

`GET /client/companies/:companyId/situacao-fiscal` (rota NOVA, em `apps/api/src/routes/client/index.js`)
lê o `CompanyFiscalStatus` que a consulta do ESCRITÓRIO gravou e devolve o relatório já interpretado
por **`parseSitfisRelatorio`**, o parser do backend — não há segundo parser.

- ⚠⚠ **NÃO EXISTE CONSULTA AQUI, E NUNCA PODERÁ EXISTIR.** A consulta ao SERPRO é **paga** e o
  limite AV02 do `/Apoiar` é **por CONTRATANTE**: uma consulta à toa de UMA empresa consome o limite
  da carteira inteira do escritório. É o molde já usado na carga tributária — *só ver; a caneta
  continua sendo a tela do contador*. Não há POST, não há `force`, não há botão. Travado por
  varredura de fonte (`client/__tests__/situacaoFiscalDoCliente.test.js`) **e** por teste de tela
  (nenhum `<button>` na página).
- ⚠⚠ **O PISO É `CLIENT_ADMIN`, E NÃO "MEMBRO ATIVO" COMO AS OUTRAS LEITURAS.** O relatório não é só
  dívida: o texto traz os **dados cadastrais** e o **quadro societário com o percentual de cada
  sócio** — tanto que o defeito antigo do parser era mostrar "R$ 100,00" de débito lendo o "100,00%"
  de participação. O piso escrito deste projeto para dado de sócio é `CLIENT_ADMIN`
  (`requireClientCompanyAccess.js`: *"pró-labore/certificado/sócios = CLIENT_ADMIN"*), e o
  FINANCEIRO não entra nele. ⚠ Isso foi decidido **por aplicação da regra existente**, não por
  pedido do dono — afrouxar é decisão dele, não refactor.
  - ⚠ **A ABA NÃO SOME para quem não alcança o piso**, e a TELA diz o motivo e o conserto (pedir o
    papel a quem é proprietário). Aba que aparece e some conforme a empresa deixa a barra instável,
    e o conserto precisa estar escrito em algum lugar. A tela **nem chama a API** nesse caso
    (`isAdminOrAbove`, o mesmo mapa de `lib/roles.js`) — mas quem autoriza continua sendo o servidor.
- ⚠⚠ **NUNCA CONSULTADA NÃO É "EM DIA".** É a regra que decide a tela inteira
  (`lib/situacaoFiscalNaTela.js`): `null`, ausência **e estado desconhecido** caem todos em
  `nao_consultada`, em cinza, com a frase que impede a leitura nos dois sentidos. Afirmar
  regularidade perante o fisco sem ter consultado é o erro caro — o cliente deixa de correr atrás de
  uma pendência que existe. Há teste varrendo o texto INTEIRO da página contra "em dia"/"regular"/
  "sem pendência"/"nada consta".
- ⚠ **`data-situacao-fiscal`, e NÃO o `data-status` das notas/guias.** Aquele vocabulário é
  espelhado pelo app mobile, e "paga"/"vencida" não descrevem situação perante o fisco — cor certa
  por acidente com significado errado é o defeito que "GUIA NÃO É NOTA" já registra aqui.
- ⚠ **A DATA VIAJA JUNTO DO ESTADO.** "Sem pendências" sem dizer DE QUANDO é uma afirmação sobre
  hoje que ninguém apurou hoje.
- ⚠ **A rota NÃO devolve** `podeConsultar`/`proximaConsultaEm` (governam um botão do escritório que
  não existe aqui), `protocolo` (é credencial de uma solicitação aberta no SERPRO) nem o id do PDF.
- ⚠ **A tela NÃO passa competência**: a situação fiscal é uma FOTO do dia da consulta, não um
  recorte de mês. Um seletor ali prometeria um filtro que o dado não tem.

### A tabela (`RelatorioSitfis.jsx`) — espelho, com duas mudanças

Cópia de `apps/web/src/features/fiscal/sitfis/components/SitfisRelatorioTabela.jsx` (a de lá é
escura e com cor hardcoded). As regras vieram inteiras: **cada bloco declara as próprias colunas**;
**a tela mostra as colunas que o PDF mostra, todas, sempre**; `Sdo. Dev. Cons.` é a coluna que
responde *"quanto devo hoje"*; **uma linha ilegível invalida o total do bloco**; **nada some** —
bloco que não virou tabela aparece cru, com o aviso.

⚠⚠ **As duas mudanças são por causa de QUEM LÊ:**
1. **O cliente não tem o PDF.** Onde o escritório manda *"confira no PDF oficial"*, aqui a saída é
   uma só: falar com o contador. Há teste varrendo a página contra a palavra "PDF".
2. `situacao` nula **nunca** lê como "em dia" (acima).

⚠ **A rolagem é quem cede**: tabela larga rola dentro do `.table-wrap`; coluna de relatório fiscal
não some para caber na tela. Conferido em 375px e 1280px.

⚠ **O mock alcança os CINCO estados** — com pendência (com tabela, total, anotação, o bloco que não
virou tabela e a linha que não fechou em colunas), em parcelamento (o bloco do SIEFPAR, lido por
pares), regular, regular **sem relatório guardado**, e não consultada. E ele **exerce o piso de
papel**: `pc-002` é FINANCEIRO e leva 403 `insufficient_role`, como o servidor faria.

## ⚠⚠ A MARCA (23/08/2026) — a logo substituiu o texto

Pedido do dono: usar o kit da Altan *"na nossa página, página de login, favicon do site"*, e **tirar
o "Portal do Cliente" escrito**. Os três pontos de texto viraram `<LogoAltan />`: o `<h1>` do login,
o `<span class="brand">` da topbar e o `<title>` da aba (hoje `Altan Contabilidade`).

- ⚠⚠ **SVG INLINE NO DOM, NUNCA `<img src="…svg">`.** O letreiro do kit é `<text>` na fonte **Inter**,
  e um SVG usado como imagem é documento isolado: **não enxerga as fontes da página**. Como imagem,
  "ALTAN" sairia em Segoe UI no Windows, Arial no macOS e Roboto no Android — e o certo seria
  justamente o que aparece na máquina de quem desenvolve.
- ⚠ **A Inter entra AUTO-HOSPEDADA** (`public/fonts/`, 48 KB, variável), e é a primeira fonte não-
  nativa do app. O `CLAUDE.md` manda discutir dependência nova: **foi discutido, e o dono escolheu
  carregar a Inter**. Host externo foi recusado porque este app faz zero requisição externa e o modo
  demonstração é offline. ⚠ `--font` **não mudou**: só a logo usa Inter.
- ⚠⚠ **NA TOPBAR A MARCA É SÓ O SOL, E ELA VOLTA AO INÍCIO** (dono, 23/08/2026: *"tire a 'Altan
  contabilidade' e deixe apenas o Sol no canto superior, e ao clicar volta ao início"*).
  `<LogoAltan variante="marca">` recorta a janela do MESMO desenho — a arte não foi redesenhada nem
  duplicada. ⚠ O letreiro **não é escondido por CSS: ele deixa de ser renderizado**; um `<text>`
  invisível continuaria no `textContent` e no nome acessível, e a marca "sem letras" ainda seria
  lida como tendo letras. ⚠ O letreiro **continua inteiro no LOGIN**, que é onde a marca se
  apresenta — há teste guardando as duas pontas.
  - ⚠ É `<a href="#/home">` com o MESMO tratamento de clique das abas (`oNavegadorAssumeOClique`):
    Ctrl/Cmd+clique abre em nova guia, o clique normal continua SPA. Um `<button>` perderia as
    cinco coisas que o `href` dá de graça.
  - ⚠ O `aria-label` diz a marca **e** o destino, e **não repete "Início"**: dois links com o mesmo
    nome, um deles imagem, fazem a navegação por lista de links virar adivinhação.
- ⚠⚠ **O `<h1>`/`<span class="brand">` FICARAM, com a logo dentro.** Tirar o `<h1>` deixaria a página
  sem cabeçalho de nível 1, e quem passa a dar o nome acessível é o `<title>` do SVG — por isso o
  teste afirma `getByRole("img", { name: "Altan Contabilidade" })`, nunca a existência de um `<svg>`.
  Texto que some da tela sem nome acessível no lugar é o portal ficando mudo para leitor de tela.
- ⚠ **`.brand` ganhou `flex-shrink: 0`.** A regra vizinha `.topbar > * { min-width: 0 }` existe
  porque o nome longo da empresa já fez a página rolar para o lado em 375px; sem o `flex-shrink`,
  ela passaria a espremer a MARCA em vez do nome. Conferido: 119×26 px, sem rolagem, em 375 e 1280.
- ⚠ **As cores são tokens, e o par é do FUNDO.** `--logo-sol` / `--logo-horizonte` / `--logo-tinta` /
  `--logo-subtitulo`. Aqui vale o par de fundo CLARO — a linha do horizonte da variante escura
  (`#AEB6D3`) sobre o branco desta superfície mede **1,97:1** e some.
- ⚠ **O `viewBox` (`30 56 340 74`) é recorte medido, não conta de cabeça** — no arquivo oficial a
  marca ocupa 52% da largura, com 42% de margem morta à direita. A borda direita foi fixada com a
  tinta REAL medida no navegador (`getBBox()`, descontando o `letter-spacing` que sobra depois da
  última letra): 359,8, contra 370 da caixa. **Trocar a fonte da marca obriga a medir de novo** —
  errar para menos corta a última letra de "CONTABILIDADE", porque a raiz de um SVG recorta.

## AUTENTICAÇÃO

⚠ **`accountGate.js` é regra de PRODUTO**: conta `FIRM` que entrasse aqui veria a tela do cliente —
com UMA empresa, os números DELA — e concluiria coisas erradas sobre a própria carteira. Vive fora
do mock e do real, chamada pelos dois: se morasse só num, o modo offline mentiria sobre a regra mais
importante da tela de login.

⚠ `mensagens.js` traduz código → frase de cliente. `invalid_reset_token` cobre **quatro** casos
(link inexistente, adulterado, vencido, já usado) e o servidor não diz qual **de propósito** — "este
link já foi usado" confirmaria a quem chutou que a conta existe. A frase dá o CONSERTO, que é o
mesmo nos quatro. ⚠ Não é o mesmo código que `invalid_token` ("sua sessão expirou").

⚠ `useCarregamento` (`lib/hooks.js`) descarta resposta atrasada: ao trocar de empresa, a requisição
da anterior pode responder depois da nova, e a tela mostraria os números de uma empresa sob o nome
de outra.

## TESTES

`npm test -w @contabilidade/portal-cliente-web` → **1.132 testes, 58 suítes, todas verdes** (medido
em 27/08/2026, depois do fluxo de caixa real; ⚠ nesta rodada uma suíte foi **removida** —
`diaDoFluxo.ligacao.test.jsx`, do painel do dia, que deixou de existir — e duas nasceram no lugar;
eram 968/52 em 24/08 depois do `ciclo` no contrato, eram 947/51 no meio da rodada da auditoria, eram 894/48 em 23/08 com a marca da topbar, 814/45 depois
da marca, 807/44 depois da situação fiscal, 683/38 em 20/08, e 557/32 antes do lote por planilha). Não existiam até 18/08 (`d5a91490` subiu os primeiros 101).
**0 suíte falhando é o estado esperado.**

⚠ **`npm test` PASSA COM JSX QUEBRADO — só `npm run build` pega.** Rode os dois.

⚠ **`jest.config.js` e `babel.config.js` são cópia deliberada de `apps/web`**, letra por letra — um
segundo jeito de testar dentro do mesmo monorepo é um jeito a mais de esquecer de rodar.

⚠⚠ **`import.meta` quebra em tempo de PARSE.** O Jest roda em CommonJS: o arquivo inteiro morre
antes do primeiro teste, e **quem paga não é quem escreve, é quem IMPORTA**. Aqui os dois pontos são
`src/api/index.js` (`VITE_API_MODE`) e `src/api/real/realApi.js` (`VITE_API_BASE_URL`), e
`EmitirNotaPage.jsx` importa `../../api` — o teste de ligação da emissão cairia antes do primeiro
`expect`, com mensagem que não aponta para a tela. Resolvido na raiz: `babel.config.js` reescreve
`import.meta.env` → `process.env` **só no env `test`**. **Nenhuma suíte precisa de mock para isso.**

⚠ **Regra e ligação são dois testes, e os dois são obrigatórios.** Há 9 arquivos `*.ligacao.test.jsx`.
O caso da descrição acima é a prova: a regra estava certa e passava; a tela mostrava vazio.
⚠ Testes de ligação renderizam **dentro de `StrictMode`** — React 19 roda cada efeito duas vezes, e
foi assim que a guarda "já apliquei" do modelo morreu (o painel dizia "preenchido a partir da nota
nº X" sobre um formulário vazio).

## ⚠⚠ "MUDOU LÁ, MUDA AQUI" — os espelhos

Estes módulos são cópias deliberadas do portal do escritório, **sem código compartilhado**. Não há
pacote comum; a duplicação é conhecida e a obrigação de sincronizar é sua:

| aqui | original |
|---|---|
| `emitir/lib/valorDaNota.js` | `apps/web/src/features/notas/lib/valorDaNota.js` |
| `emitir/lib/consultaTomador.js` | `apps/web/src/features/notas/lib/consultaTomador.js` — ⚠ os 10 exports e a lógica são os MESMOS; diverge **uma frase**, e ela é de produto: lá o endereço do tomador é OPCIONAL (*"ou deixe vazio"*), aqui o formulário marca os cinco campos como `required`, então a frase diz *"a nota exige o endereço completo"*. Copiar a de lá ofereceria uma saída que este formulário não aceita |
| `emitir/lib/reaproveitarNota.js` | `apps/web/src/features/notas/lib/reaproveitarNota.js` |
| `emitir/lib/descricaoSugerida.js` | `apps/web/src/features/notas/lib/descricaoSugerida.js` |
| `emitir/lib/cargaTributaria.js` | `apps/web/src/lib/nfse/cadastroEmissaoNfse.js` — ⚠⚠ **espelho PARCIAL, e só de `lerPercentualCarga`**: o de lá exporta 11 funções (código de serviço, série de RPS, benefício municipal, `faltasParaEmitir`) que são do CADASTRO, tela do contador. Sincronizar o arquivo inteiro traria para o cliente regras que ele não pode exercer |
| `emitir/lib/codigoServicoDaNota.js` | `apps/api/src/application/nfse/codigoServicoDaNota.js` (**autoridade**) |
| `notas/lib/cancelamentoNota.js` (`MOTIVOS_CANCELAMENTO`) | `apps/api/src/application/nfse/motivosDeEvento.js` (**valida**) |
| `notas/lib/danfseDaNota.js` | `apps/web/src/features/notas/lib/danfseDaNota.js` (⚠ contratos DIFERENTES) |
| `notas/lib/loteDanfse.js` (`LOTE_MAXIMO`) | `apps/api/src/application/nfse/danfse/loteDanfseDoPortal.js` (**autoridade**) — ⚠ era cópia dentro do `mockApi` até 28/08/2026; mudou para cá porque a TELA passou a precisar do teto, e o mock agora o importa |
| `lote/lib/colunasDoLote.js` (`COLUNAS_DO_LOTE` **e** `CAMPOS_DA_REVISAO`) | `apps/api/src/application/nfse/lote/colunasLote.js` (**autoridade**) — ⚠ são DUAS listas desde 20/08/2026: quatro colunas de planilha, **doze** campos de revisão (`documento` · `descricao` · `valor` · `competencia` · `nome` · `email` · `cMun` · `cep` · `xLgr` · `nro` · `xBairro` · `xCpl`) — ⚠ dizia **onze** até 24/08/2026, contado a mão; hoje é o `length` medido da lista do backend |
| `lote/lib/estadoDaLinhaDoLote.js` (`ESTADO`) | `apps/api/src/application/nfse/lote/classificarLinhaLote.js` (**autoridade**) |
| `lib/servicosNacionais/` | tabela gerada; `servicosNacionais.data.js` sai de `apps/api/scripts/gerar-lista-servico-nacional.mjs`, que **escreve nos dois portais** — **não editar à mão** |
| ~~`lib/municipios/` (o dado)~~ | ⚠ **DEIXOU DE SER ESPELHO EM 20/08/2026**: a tabela do IBGE virou arquivo único em `@contabilidade/shared/municipios-ibge`. A REGRA (`municipioIbge.js`) continua uma por portal, de propósito — a do escritório carrega textos de cadastro que não são do cliente |
| `painel/lib/tabelaDoFluxo.js` (`STATUS`, a derivação da célula) | `apps/api/src/application/fluxo/lib/fluxoDeCaixa.js` (`statusDoConjunto`, **autoridade**) — ⚠ **amarrado por teste**: o daqui importa a função de lá e exige o mesmo veredito em 7 combinações de procedência. Sem o amarre, a tela pintaria de preto o que o servidor chama de previsto |
| `lib/roles.js` | `apps/api/.../emissaoClienteAutorizacao.js` + `portal-cliente-mobile/src/roles.ts` |
| `lib/cliqueDeLink.js` | `apps/web/src/components/ui/cliqueDeLink.js` (quem assume o clique numa aba-link) |
| `guias/lib/rotuloGuia.js` | `apps/web/src/features/guides/lib/rotuloGuia.js` (`rotuloTipoGuia`) — ⚠ **amarrado por teste**: o daqui importa a função de lá e exige o mesmo veredito em 12 casos. ⚠ O ramo do PARCELAMENTO **não** é espelho (lá o rótulo é montado no front; aqui o backend manda `parcelamentoLabel` pronto); o que fica travado é a PRECEDÊNCIA |
| `guias/lib/linhaDigitavelTela.js` | `apps/web/src/features/guides/lib/linhaDigitavelTela.js` — ⚠ **as três ausências (`NAO_TENTADA`/`NAO_ENCONTRADA`/`DIVERGENTE`) são as mesmas; o TEXTO diverge de propósito**: o cliente **não vê os dois valores** da divergência, que são material de trabalho do contador |
| `api/real/brasilApi.js` | `apps/web/src/features/onboarding/lib/brasilApi.js` — ⚠ mesmo endpoint e mesmo `soDigitosCnpj`; **os mapeadores NÃO são espelho** (`mapearParaOnboarding`/`mapearParaFormularioEmpresa` são de cadastro de empresa, não de tomador de nota). ⚠⚠ E aqui ele **nunca lança `ApiError`** — lançar entraria no wrapper do fallback e a queda da BrasilAPI viraria **dados de empresa do mock** numa tela que emite nota fiscal |
| `components/ui.jsx` (`BotaoCopiar`) | `apps/web/src/components/ui/BotaoCopiar.jsx` — ⚠ mesma promessa (*"o retorno não mente"*: `navigator.clipboard` não existe em contexto inseguro, e o botão diz "não deu" em vez de piscar "copiado"). ⚠ Diverge o DESENHO: lá é um ícone de 20×18; aqui é um `.btn` com palavra. ⚠ O `stopPropagation` faltava aqui até 24/08/2026 |
| `components/LogoAltan.jsx` | `apps/web/src/components/ui/LogoAltan.jsx` — ⚠ o desenho é IDÊNTICO; o que diverge são os TOKENS de cor, um par por portal (ver `tokens.css`) |
| `fiscal/RelatorioSitfis.jsx` + `fiscal/lib/situacaoFiscalNaTela.js` (`COLUNAS_VALOR`, `COLUNA_TOTAL`, `parseValorBR`, `totalDoBloco`) | `apps/web/src/features/fiscal/sitfis/components/SitfisRelatorioTabela.jsx` — ⚠ paleta e DUAS frases divergem de propósito (o cliente não tem o PDF; `situacao` nula não lê como "em dia") |

⚠ Duas leituras da mesma coluna divergem na primeira correção — e aí as duas telas afirmam coisas
diferentes sobre a MESMA empresa.

## ⚠⚠ A ARMADILHA DO `select` EXPLÍCITO — já mordeu TRÊS vezes

`legacyCompanySelect`, em `apps/api/src/routes/client/index.js:102`, é um `select` do Prisma.
**Coluna que não está listada volta `undefined`, sem erro nenhum**: a rota responde 200 e a tela
"só não mostra". Um teste de comportamento passa.

As três vítimas, todas nesta semana:
1. `codigoMunicipioIbge`;
2. a carga tributária (`pTotTribFed/Est/Mun`, hoje `:157`) — a tela do cliente não sabia se o
   cadastro estava completo e por isso descrevia **as duas saídas** em vez do estado real;
3. `codigosServicoNacional` (hoje `:132`) — chegava só o singular, e por isso o seletor de código de
   serviço **não tinha o que oferecer nem como saber que havia o que escolher** (`57366057`).

⚠ Por isso a trava virou **varredura do texto do `select`**
(`routes/client/__tests__/contratoDeEmpresasDoCliente.test.js`), e não teste de comportamento.
**Campo novo que a tela do cliente precise ler: acrescente a linha no `select` E na varredura.**

⚠ O mesmo vale para `emissaoClienteLiberada` (`:196`, exposto como `emissaoNfseLiberada` em `:246`):
enquanto ele não viajava, o app só descobria o portão **pela recusa**, depois de a pessoa preencher
a nota inteira. ⚠ E **só a flag** — `emissaoClienteLiberadaEm`/`...Por` são auditoria do escritório
e não são dado do cliente. Ampliar esse `select` é por onde vazamento entre lados acontece sem
ninguém notar.

## ⚠ O QUE NÃO EXISTE — e por quê

- **Substituição de NFS-e** — **escopo FECHADO** por decisão do dono, 19/08/2026: *"esqueça
  substituir então, deixe apenas o cancelar."* ⚠ E o impedimento técnico **tinha acabado de cair** (o
  XSD e o ANEXO_I foram versionados horas antes, com o grupo `<subst>` inteiro): quem for construir
  isso está **reabrindo uma decisão, não terminando um trabalho**. O que decidiu foi a regra de
  negócio — E0060/E0061 proíbem a substituta de alterar competência/serviço/local (não optante) e
  tomador/competência/valor (Simples), que é exatamente o que ele queria poder corrigir. Para o uso
  dele, cancelar e emitir nova são dois atos deliberados e resolvem; substituir não.
- ~~**A EMISSÃO em lote**~~ — ⚠⚠ **SAIU DESTA LISTA EM 20/08/2026: ela foi construída.** Este item
  já havia sido corrigido uma vez (dizia que o lote inteiro não existia) e ficou falso de novo. Hoje
  existe o ato: botão, confirmação, rota, e as regras da emissão em série (persistida, sequencial,
  parada no desfecho DESCONHECIDO, retomada depois da linha indeterminada, idempotente). ⚠ Nasce
  DESLIGADA por `INTEGRACAO_NFSE_LOTE`, com o **servidor** recusando. Ver a seção do lote.
- **Envio da nota por e-mail ao tomador** — não existe. O campo `tomadorEmail` do formulário vira o
  `<email>` **dentro da DPS** (`nfsePayload.js:150` → `NfseService.js:820`); nós não disparamos
  e-mail nenhum a partir daqui.
- **Detalhe de nota / modal / rota por nota** — a lista é uma tabela de 7 colunas, o `<tr>` não tem
  `onClick`, e o roteamento é por hash com três destinos fixos. A linha inteira **não** virou
  clicável de propósito: ela teria um destino só — a tela que pratica ato fiscal — e clique acidental
  ali é caro.
- **NF-e** — só é capturada da SEFAZ; este portal não a emite nem a cancela.
- **Router, Redux/Zustand, Tailwind, CSS por componente** — nenhum deles. Não introduza sem discutir.

## DEPLOY

Railway com **Root Directory = `apps/portal-cliente-web`**. `Dockerfile` (Vite → `dist/` → Caddy) e
`Caddyfile` são cópias deliberadas de `apps/web` — divergir faria dois serviços irmãos falharem por
motivos diferentes.

⚠ **`railway.toml` próprio existe por causa de uma falha de build real (18/08/2026)**: sem ele o
serviço caía no `railway.toml` da RAIZ, que é o da API, e o build morria em
`COPY apps/api ./apps/api → "/apps/api": not found`. ⚠ Os caminhos ali são relativos ao **root do
serviço**, não ao do repositório.

⚠ **`try_files {path} /index.html` no `Caddyfile`** é o que faz o SPA funcionar: sem ele,
`/redefinir-senha?token=…` — exatamente o que o link do e-mail abre — devolve 404.

⚠ **Variáveis `VITE_*` são de BUILD**, embutidas no bundle; precisam existir como variáveis do
serviço no painel (o Railway as passa como build args). Dev local: `npm run dev`, porta **5210**
(escolhida para não brigar com o portal do escritório).
