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

## ⚠⚠ O PAINEL — FLUXO DE CAIXA ⇄ DRE, MOCKADOS (21/08/2026)

> Dono: *"por padrão o portal vai exibir um fluxo de caixa, mockado por enquanto pois não temos back
> end, junto disso teremos de alterar para um DRE, também mockada por enquanto"*.

`features/painel/PainelPage.jsx` é o que a rota `home` renderiza. **A antiga `HomePage` foi
absorvida, não descartada**: o seletor `#competencia-home` e as três consultas REAIS do resumo do mês
continuam ali — quatro casos de `competenciaAtravessaAsAbas.ligacao.test.jsx` medem exatamente isso,
e cairiam **por motivo certo** se o painel os perdesse.

- ⚠⚠ **NÃO HÁ BACKEND PARA NENHUM DOS DOIS, E NÃO HÁ ORIGEM PARA ENTRADAS.**
  `GET /client/.../fluxo` **existe e NÃO é fluxo de caixa** — é a lista de guias liberadas em aberto,
  só saídas. `POST .../ofx/import` e `GET .../transactions` são stubs **501**, e nota emitida não é
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

### ⚠⚠ O FLUXO É DIÁRIO, E O DIA ABRE (23/08/2026)

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
  precise rolar os dias"*). Hoje: `Início` → os três cards → **Próximos vencimentos** → o bloco de
  demonstração, **por último**.
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

`npm test -w @contabilidade/portal-cliente-web` → **894 testes, 48 suítes, todas verdes** (medido em
23/08/2026, depois de a marca da topbar virar só o sol; eram 814/45 depois da marca, eram 807/44 depois da situação fiscal, 683/38 em 20/08, e 557/32 antes
do lote por planilha). Não existiam até 18/08 (`d5a91490` subiu os primeiros 101).
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
| `emitir/lib/consultaTomador.js` | `apps/web/src/features/notas/lib/consultaTomador.js` |
| `emitir/lib/reaproveitarNota.js` | `apps/web/src/features/notas/lib/reaproveitarNota.js` |
| `emitir/lib/descricaoSugerida.js` | `apps/web/src/features/notas/lib/descricaoSugerida.js` |
| `emitir/lib/cargaTributaria.js` | `apps/web/src/lib/nfse/cadastroEmissaoNfse.js` |
| `emitir/lib/codigoServicoDaNota.js` | `apps/api/src/application/nfse/codigoServicoDaNota.js` (**autoridade**) |
| `notas/lib/cancelamentoNota.js` (`MOTIVOS_CANCELAMENTO`) | `apps/api/src/application/nfse/motivosDeEvento.js` (**valida**) |
| `notas/lib/danfseDaNota.js` | `apps/web/src/features/notas/lib/danfseDaNota.js` (⚠ contratos DIFERENTES) |
| `lote/lib/colunasDoLote.js` (`COLUNAS_DO_LOTE` **e** `CAMPOS_DA_REVISAO`) | `apps/api/src/application/nfse/lote/colunasLote.js` (**autoridade**) — ⚠ são DUAS listas desde 20/08/2026: quatro colunas de planilha, onze campos de revisão |
| `lote/lib/estadoDaLinhaDoLote.js` (`ESTADO`) | `apps/api/src/application/nfse/lote/classificarLinhaLote.js` (**autoridade**) |
| `lib/servicosNacionais/` | tabela gerada; `servicosNacionais.data.js` sai de `apps/api/scripts/gerar-lista-servico-nacional.mjs`, que **escreve nos dois portais** — **não editar à mão** |
| ~~`lib/municipios/` (o dado)~~ | ⚠ **DEIXOU DE SER ESPELHO EM 20/08/2026**: a tabela do IBGE virou arquivo único em `@contabilidade/shared/municipios-ibge`. A REGRA (`municipioIbge.js`) continua uma por portal, de propósito — a do escritório carrega textos de cadastro que não são do cliente |
| `lib/roles.js` | `apps/api/.../emissaoClienteAutorizacao.js` + `portal-cliente-mobile/src/roles.ts` |
| `lib/cliqueDeLink.js` | `apps/web/src/components/ui/cliqueDeLink.js` (quem assume o clique numa aba-link) |
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
