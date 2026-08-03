# CLAUDE.md — Empresas (apps/web/src/features/companies)

Feature da carteira de empresas: dashboard (lista), detalhe (abas), formulário, certificado.

## Subpastas

- `list/` — **Dashboard** (`pages/renderCompaniesHomePage.jsx`, `components/renderCompanyCard.jsx`).
- `detail/` — página de detalhe da empresa com abas (`pages/renderCompanyDetailPage.jsx`,
  `components/renderCompanyDetailHeader.jsx`). **Aba default = Anotações** (era Lançamentos: se a
  empresa tem particularidade, ela precisa ser lida antes de mexer em qualquer número).
- `form/`, `certificate/`.

## Dashboard — três visões

`modoVisao` em `renderCompaniesHomePage`: **Cards · Ano · Calendário**. A última não é "lista de
empresa" — é o mesmo recorte da carteira por outro eixo (o tempo).

**Obrigações saiu do seletor de visões** e virou página própria em **Configurações ▾ → Obrigações
do escritório** (`/obrigacoes`, `features/obrigacoes/components/renderObrigacoesPage.jsx`).
Cadastrar obrigação **define** o que a carteira passa a dever; as visões **olham** a carteira — são
verbos diferentes. O que se entrega continua visível no calendário, que é onde se trabalha.

Obrigação **não é guia**: guia é o que o cliente paga, obrigação é o serviço do contador — por isso
a tela não fala em valor nem pagamento. Obrigação com `conclusaoAutomatica` **não mostra botão de
concluir**: o backend recusaria o clique. Dentro dela, **Regras do escritório**
(`renderRegrasObrigacao.jsx`) aplica uma obrigação a várias empresas — é o que substitui o catálogo
pré-carregado.

⚠ `PAGE_TO_PATH`/`pathToPageName` (`useManageAuthSession.js`) tinham `calendario` e `pendencias`
**sem bloco correspondente no `App.jsx`** — as URLs caíam no dashboard em silêncio. Foram removidas
junto. Entrada nova só vale acompanhada do `if (session.page === …)`.

### Calendário (`features/calendario/components/renderCalendarioGrid.jsx`)

Quatro visões: **Mês · Semana · Dia · Agenda**, com atalhos `M S D A` e `T` (hoje) — ignorados
quando o foco está num campo. **Agenda é o default em tela estreita**: a grade de mês vira 42
células ilegíveis num celular. `ehTelaEstreita()` trata largura 0 como *desconhecida*, não como
estreita — sem isso a tela abre em modo celular num container ainda sem layout e fica assim, porque
`visao`/`sidebarAberta` são valores iniciais e não se recalculam.

**À esquerda fica a CARTEIRA e só ela**, não um painel que aparece e some: a lista com **todas** as
empresas está sempre ali, e clicar numa obrigação do calendário apenas a **estreita** para quem tem
aquela obrigação naquele dia (o ✕ devolve a lista inteira). Cada linha traz **razão social e o CNPJ
embaixo** — é como o contador confere que é a empresa certa; razões sociais se parecem, CNPJ não.
Fora do filtro, um contador mostra quantas obrigações a empresa tem em aberto no mês visível — some
no zero, senão a coluna vira uma fileira de "0". Dentro da aba de uma empresa o bloco não existe.

Duas coisas saíram da lateral por decisão do dono:
- O **mini-calendário**, de vez (a função foi deletada): a navegação por dia já está nos ‹ › e no
  "Hoje", e ele ocupava a altura que a lista precisa.
- A **legenda/filtro de categoria**, que subiu para uma linha no topo. Ela é sobre o que a GRADE
  mostra; embaixo da lista competia por altura com ela. Segue agindo na **exibição**, não na busca.

Em tela estreita a sidebar vira **drawer**: largura total e a grade some enquanto está aberta.

⚠ A grade usa `flex: 1 1 0`, **não** `auto`. Com `auto` a base é o tamanho do conteúdo (~1185px
numa grade de 7 colunas); somada aos 232px do painel isso estoura a linha, o `flex-wrap` entra e o
painel vai parar **em cima** da grade em vez de ao lado dela.

**Guia e obrigação têm cores e símbolos distintos** (`•` laranja × `▸` verde) porque respondem a
perguntas diferentes; obrigação **vencida** ganha contorno vermelho por cima da cor da categoria.
`fmtMoney` só aparece em guia — obrigação não tem valor.

### Agrupamento por obrigação + painel de empresas

Uma regra aplicada a 38 empresas gerava 38 chips no mesmo dia. As **obrigações** agrupam por
`grupoChave` (= `regraId`, ou `nome:<normalizado>` quando avulsa — o nome sozinho juntaria
obrigações homônimas de regras diferentes); **guia continua uma por empresa**, porque valor e
vencimento são de cada uma. O chip conta as **em aberto**, não o total: "· 6" num dia com tudo
concluído seria mentira, então o número some e sobra o nome riscado.

Duas armadilhas, as duas reais:
- `porDiaAgrupado` deriva de **`porDiaVisivel`**, não de `porDia`. O filtro de categoria casa por
  `i.tipo`, e o item agrupado é `"obrigacaoGrupo"` — agrupar antes de filtrar mata o checkbox
  "Obrigações" em silêncio.
- O estado guarda a **chave** (`{grupoChave, data}`), não o objeto. Guardando o objeto, concluir
  uma empresa deixaria a lista mostrando o estado pré-conclusão até alguém re-clicar no chip.

Na linha da empresa, o ✓ some quando a obrigação é `conclusaoAutomatica` (o backend recusa o
clique) e quando já está concluída.

O número no chip conta **empresas**, então só aparece quando `total > 1` — com uma só ele não
informa nada, e dentro da aba da empresa (abaixo) todo grupo tem tamanho 1: seria "· 1" em cada
chip da grade.

### Aba Obrigações dentro da empresa

É o **mesmo** `CalendarioGrid`, com `companyIdFixo` — não uma segunda tela a manter em paralelo.
Fica no grupo **Contabilidade** (obrigação é serviço a entregar, não tributo a pagar). Com a prop
setada: o `<select>` de empresa some (não há o que escolher) e **os atalhos de teclado desligam** —
eles são globais (`window`), e ali o calendário é um bloco da página, não a página; apertar "d"
trocaria a visão de qualquer lugar da tela.

A aba **não monta sem `companyId`**: montar antes buscaria a carteira inteira dentro da página de
uma empresa. Mesmo motivo pelo qual `mockApi.getCalendario` passou a filtrar também
`pendenciasDoMes` (antes tinha id fictício e ignorava o filtro — a aba de uma empresa listava a
pendência de outra). Marco do escritório (`portalClientId: null`) continua aparecendo: vale sempre.

## Barra "Fechamento do mês" (o que trava a carteira)

`GET /firm/companies/fechamento?competencia=` (via `api.getCarteiraFechamento`) responde, por
empresa, **por que** ela ainda não pode fechar. Vira uma barra de contagens acima dos cards:
**Todas · ✅ Prontas para fechar · ☐ Falta check-list · ⚠ Lançamento com problema**, mais o aviso
de quantas já estão fechadas. Antes, essa pergunta custava abrir empresa por empresa.

Três decisões:
- Este filtro **remove** quem não bate — é lista de trabalho, não ordenação (diferente de
  `documentFilter`/`serproFilter`, que só reordenam).
- Empresa **sem linha no agregado fica de fora** de qualquer recorte: chamar de "pronta" quem o
  servidor não respondeu seria pior que omitir.
- Falha na chamada é **silenciosa e a barra some** inteira. É um atalho sobre a lista; um número
  errado sobre fechamento é pior que número nenhum, e derrubar o dashboard por causa dele, pior
  ainda.

**Fechar em lote** (`🔒 Fechar as N`) só aparece **dentro do recorte "Prontas"** — na barra solta
seria fácil clicar sem ter olhado quem vai ser fechado. O laço é **sequencial** (são escritas; N em
paralelo contra o mesmo backend para ganhar dois segundos não paga o risco) e **não aborta no
primeiro erro**: a rota revalida cada empresa, então quem deixou de estar pronta entre a leitura do
agregado e o clique é recusada e as demais seguem. O relatório final conta as recusas.

⚠ No **mock** o check-list é sintético e varia por índice — o mock não guarda essas caixas por
empresa, e um check-list igual para todas deixaria o filtro sem nada para separar. Os **bloqueios**,
esses, saem dos lançamentos de verdade do mock.

## Dashboard — reorganização (Lote C)

- **Cards** (uma competência) e **Ano** (`components/renderAnnualGrid.jsx` →
  `GET /firm/companies/annual?ano=`) — o Calendário entrou depois. Na grade anual
  cada célula tem **dois** indicadores — ■ fechamento contábil e ● apuração transmitida (são
  coisas diferentes e podem divergir; por isso não viram um só). Clicar abre a empresa **naquela
  competência** (`onOpenCompany(companyId, competencia)` → `setFilter("competencia", …)` no App).
- **Filtros:** só **busca** e **competência** ficam aparentes; o resto vai no botão **Filtros**
  (painel ancorado à DIREITA — ancorado à esquerda ele vazava pra fora da tela). A competência tem
  setas ‹ › (`shiftCompetencia`, aritmética de ano/mês pura, sem `Date`, pra não escorregar em fuso).
- **Botões:** "Funções em lote" virou **"🔎 Consultas"** e absorveu a antiga página **Pendências**
  (agora aba "Situação Fiscal" lá dentro). O botão Pendências não existe mais aqui.
- **Selo de processos em segundo plano** (`hooks/useBackgroundJobs.js` → `GET /firm/jobs/ativos`):
  avisa que há download em lote rodando mesmo depois de sair da página que disparou. Polling
  adaptativo (4s ativo / 30s ocioso) e para com a aba escondida.

## ⚠ Regime da empresa mora em `legacyCompany`

`selectedCompany.regimeTributario` **não existe** — `buildFirmCompanyPayload` só devolve o regime
dentro de `legacyCompany`. `renderCompanyDetailPage` lia do topo e obtinha `undefined` sempre, o que
silenciava três telas: "+ Parcelamento Simples" nunca aparecia, e o filtro por regime da Circular e
do "+ Subir Guia" recebia undefined. Hoje há um `companyRegime` único no topo do componente, com
fallback para as duas formas. Não voltar a ler do topo do payload.

## Card da empresa (Lote C)

- **Regime · SERPRO · A1** usam **um só design** (pílula com borda) — antes SERPRO era badge com
  classe CSS e A1 era fonte colorida.
- **Guias ⇄ "Enviado":** as tags de guia aparecem enquanto houver guia não enviada; quando
  **todas** forem enviadas, o selo **"📤 Enviado"** ocupa o lugar delas. Guia nova/recalculada/
  retificada volta pra `PENDING` no backend → `guidesEnvio.todasEnviadas` vira false → as tags
  reaparecem. Campo vem de `attachGuideComplianceToCompaniesList`.
- **`folha`** (rosa) ao lado de `parc`, quando `company.temFolha`. Fica na linha da identidade —
  junto de regime e parcelamento — porque é **característica da empresa, não evento do mês**, o
  mesmo argumento que já tinha movido o `parc` pra lá. Não contraria o "selo só para exceção" que
  vale logo abaixo: aquela regra é sobre **estado** (SERPRO apto, A1 válido), onde o normal é
  silêncio. `temFolha` ≠ `hasProlabore`: sócio com pró-labore e nenhum empregado não tem folha.
- **⚠ Pendência fiscal** (SITFIS) ao lado de "apurada" e **PARC** quando há parcelamento ATIVO
  (`fiscalSituacao` / `temParcelamento`, de `attachFiscalParcelamentoToCompaniesList`).
  `fiscalSituacao: null` (nunca consultada) **não** vira selo — não afirmamos nada sobre o fisco
  sem ter consultado.

## Dashboard (Q17)

- **Filtro por competência** (picker no topo, default = mês anterior) → recarrega via
  `onChangeCompetencia` → `loadCompanies(competencia)` → `GET /firm/companies?competencia=`.
- **Filtro default = pendências** (`documentFilter="pending"`): empresas com pendência vêm na
  frente. Guia `vazio` conta como resolvida (não é pendência).
- **Cores (dois níveis):**
  - **Tags por tributo** (`getComplianceTags` lê `state`): verde=present, **amarelo=vazio**,
    vermelho=missing. O amarelo fica **só na tag**.
  - **Card inteiro** muda de cor (ciano + 🔒 "Fechada") **quando a empresa está fechada**
    (`company.fechamentoContabil.fechado`, vindo de `attachFechamentoContabilToCompaniesList`).
  - Selo "E-mail do mês" (Q16): verde enviado / âmbar pendente.

## Documentos e Anotações (Lote D)

Duas sub-abas novas no grupo **Cadastro** (`documents/`, hook `useCompanyDocuments.js` com os dois
estados). São cadastrais, não fiscais — é onde o contador já procura dado de empresa.

- **Documentos** (contrato social, cartão CNPJ, inscrições, alvará): seleção múltipla + barra de
  ações **Baixar** / **Enviar por e-mail**, no formato da barra única das Guias (Q57). O download
  passa por `fetch` com Bearer e vira Blob — um `<a href>` não leva o token. O envio **confirma
  antes** (lista os nomes) e o retorno diz quantos foram e para quem.
- **Anotações**: a **fixada** é renderizada FORA da lista, acima de tudo, em qualquer ordenação
  (data ou importância), e a fixação é **exclusiva**. As duas regras são garantidas no backend
  (`CompanyNotesService`) — o front só reflete.

O mock tem estado em memória, não retorno fixo: as duas features têm regras que só dá pra conferir
mexendo (fixação exclusiva, seleção múltipla), e um mock imutável passaria por elas sem testar nada.

## Abas do detalhe

### ⚠ A URL manda na EMPRESA, não só na aba

Por muito tempo a **aba** vinha da URL mas a **empresa** era estado solto (`useCompanies`). Duas
fontes de verdade para a mesma tela — e quando elas discordavam, a URL apontava para uma empresa e a
tela mostrava outra. O sintoma: *"clico na ERISANGELA e abre a CHAYM"*, em várias telas diferentes.

Eram três defeitos somados:

1. **`loadCompanies` auto-selecionava `data[0]`** quando nada estava selecionado. Abrir
   `/companies/<X>/…` por link ou refresh começa com o estado vazio → o app escolhia a **primeira
   empresa da carteira**, que não tem relação nenhuma com a URL. Hoje o atalho só vale **fora** de
   uma página de empresa.
2. **Nada sincronizava o estado com a URL.** Um efeito faz a URL vencer sempre — link, voltar do
   browser e refresh passaram a funcionar sozinhos.
3. **`setSelectedCompanyId(nova)` seguido de `setCompanyDetailTab(…)`** navegava para a empresa
   ANTERIOR: o `set` do React não é visível no mesmo closure, então a segunda chamada lia o valor
   velho. Trocando de empresa, use **`openCompanyTab(companyId, tab)`** com o id explícito;
   `setCompanyDetailTab` resolve pela URL e serve para trocar de aba **dentro** da mesma empresa.

`resetWorkspace` **não navega**: roda no logout, logo depois de `clearSession()` mandar para
`/login`, e um navigate ali devolveria o usuário deslogado para uma página de empresa.

Ordem/roteamento: `useManageCompaniesWorkspace.deriveCompanyDetailTab` (default `anotacoes`)
+ `GROUPS` em `renderCompanyDetailHeader.jsx` (Anotações primeiro, no primeiro nível). Navegação ao
abrir empresa: `useManageAuthSession` → `/companies/:id/anotacoes`. Aba nova exige **três** peças:
entrada em `GROUPS`, par em `SEGMENT_TO_TAB`/`TAB_TO_SEGMENT` e bloco `if` no
`renderCompanyDetailPage`. Faltando o par, a URL cai em Anotações sem erro nenhum.

## Padrões

- Componentes recebem dados/handlers por props; estado de workspace em
  `app/hooks/useManageCompaniesWorkspace.js` (expõe `dashboardCompetencia` +
  `changeDashboardCompetencia`).
- Toda chamada nova precisa de par mock/real em `src/api/`.
