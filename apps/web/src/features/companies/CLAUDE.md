# CLAUDE.md — Empresas (apps/web/src/features/companies)

Feature da carteira de empresas: dashboard (lista), detalhe (abas), formulário, certificado.

## Subpastas

- `list/` — **Dashboard** (`pages/renderCompaniesHomePage.jsx`, `components/renderCompanyCard.jsx`).
- `detail/` — página de detalhe da empresa com abas (`pages/renderCompanyDetailPage.jsx`,
  `components/renderCompanyDetailHeader.jsx`). **Aba default = Anotações** (era Lançamentos: se a
  empresa tem particularidade, ela precisa ser lida antes de mexer em qualquer número).
- `form/`, `certificate/`.

## Dashboard — quatro visões

`modoVisao` em `renderCompaniesHomePage`: **Tabela · Cards · Ano · Calendário**. As duas primeiras
listam a carteira do mês; as outras são o mesmo recorte por outro eixo (o tempo).

**Tabela é o padrão em ≥1024px; cards abaixo disso** — a grade de 6 colunas não sobrevive a 375px,
e o card mostra 8 empresas onde a tabela mostra 15+. A escolha **persiste** em `localStorage`
(antes era `useState` puro e quem preferia cards voltava ao padrão a cada refresh).
⚠ `window.innerWidth === 0` conta como *"ainda não sei"*, não como estreito — a mesma armadilha que
já fez o calendário abrir em modo celular numa janela grande.

### A regra de cor (`styles/tokens.css`)

**Cor forte = precisa de ação agora.** Neutro = cinza. Concluído = verde discreto. Vermelho **nunca**
para estado que não bloqueia o fechamento. Era isso que estava embaralhado: "falta apurar" aparecia
em âmbar em 29 de 30 empresas — quando o padrão grita, a exceção some.

Separação que sustenta a regra: **configuração** (parc, folha, A1, SERPRO) usa pílula neutra;
**categoria** (regime) usa cor de acento; **estado** usa os tokens `--state-*`, sempre com ícone
além da cor. Todo token de estado tem par `-surface` — não derive fundo com `` `${cor}22` ``,
que quebra em silêncio assim que a cor vira `var(--…)`.

### Ciclo de vida da guia (`renderGuiaChip.jsx`)

```
                    ┌─→ ✈ gerada ─→ ✓ enviada        (terminais bons)
  ⚠ falta gerar ────┤        └────→ ✖ falhou         (tentou e não saiu; NÃO é terminal)
                    └─→ ⊘ vazio                      (terminal: ausência confirmada)
```

⚠ **`✖ falhou` existia no banco e não existia na tela.** `emailStatus:"ERROR"` caía no mesmo
`state: "gerada"` do PENDING e pintava âmbar "gerada, falta enviar" — o estado de quem **nunca foi
tentado**. Como nada drena `emailNextRetryAt` (o laço saiu na Q55), a guia ficava assim até alguém
clicar por acaso. Hoje: vermelho com ícone próprio, `emailLastError` e nº de tentativas no popover,
e o botão vira **"✈ Tentar enviar de novo"** — o MESMO envio (não há mecanismo de retentativa para
sugerir). Ele conta como urgência 0 na tabela e entra no recorte "falta enviar" do topo.
Mais `conflito` (marcada sem movimento **mas** há nota emitida) e `na` (não exigido → o chip **não
renderiza**). Três tipos de ausência, três visuais — é o que a regra antiga ("a tag some quando a
guia é gerada") não conseguia dizer.

Do chip saem as ações, sem entrar na empresa: **enviar** (confirmação com destinatário à vista —
ação externa nunca dispara no clique) e **marcar sem movimento** (declaração fiscal: grava
quem/quando, mostra no popover, permite desfazer, e é **recusada** se houver faturamento).
`✓ Guias concluídas` condensa só quando **todas** estão em estado terminal — enviada **ou** vazio.

⚠ No Lucro Presumido, IRPJ/CSLL/PIS-COFINS compartilham o **mesmo `guideId`** (uma DARF só).

### Estado dominante (`lib/estadoDominante.js`)

Um chip por empresa, por prioridade: Fechada (vence tudo, é terminal) → Pendência → Falta check-list
→ Falta apurar → Zerada → Pronta p/ fechar. Fica numa função **só** porque vem de **duas fontes que
não se conhecem** — o agregado `/companies/fechamento` e o payload da empresa; duas cópias fariam a
mesma empresa aparecer de dois jeitos conforme a visão.

A ordem de urgência ordena a lista por padrão, com **desempate alfabético** (sem ele a ordem "dança"
entre recargas). Fechadas vão para o fim, colapsadas.

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

⚠ **COR = ESTADO. CATEGORIA = FORMA.** Era o contrário — a categoria era a cor (guia âmbar,
obrigação verde, marco roxo) e o estado ia num sufixo de texto. Resultado: **obrigação pendente
nascia VERDE**, a cor de "concluído", e a já entregue virava cinza; guia nascia âmbar sempre,
inclusive a que vence daqui a três semanas. Hoje a cor responde *preciso agir?* (`vencida` vermelho ·
`aFazer` âmbar, vence hoje · `futura` cinza · `resolvida` verde) e a forma responde *que tipo de
coisa é?* (`▮` guia · `▤` obrigação · `◆` marco) — a forma é o que sobrevive ao dessaturado.

- **Marco fica fora da escala de estado** (segue pela importância): é lembrete, não trabalho, e não
  existe marco "concluído".
- `estaVencida` valia **só para obrigação** (`situacao === "VENCIDA"`, campo que o backend só manda
  para elas): guia vencida e não paga tinha a cor da que vence semana que vem. A data do evento no
  calendário **é** o vencimento.
- **O dia herda a pior cor** entre seus eventos (faixa à esquerda, `piorEstadoDoDia`). A célula
  mostra 3 itens (8 na compacta) e esconde o resto num "+N" — o vencido podia estar entre os
  escondidos, e o dia ficava igual a um dia tranquilo. Resolvido **não** pinta a borda: estado bom
  não grita.

Quatro visões: **Mês · Semana · Dia · Agenda**, com atalhos `M S D A` e `T` (hoje) — ignorados
quando o foco está num campo. **Agenda é o default em tela estreita E dentro da empresa**
(`companyIdFixo`): uma empresa tem 3–6 eventos no mês, e a grade gasta 42 células para mostrar 4
marcadores; na página principal, com trinta empresas, a densidade é a informação e a grade continua
sendo o padrão. A grade de mês vira 42 células ilegíveis num celular.

⚠ Virar padrão dentro da empresa expôs dois defeitos que a agenda tinha desde sempre: as setas
`‹ ›` andavam **um dia** (a lista é montada a partir de `competencia`, ou seja cobre o MÊS — o
clique mudava a referência sem mudar a lista, e a seta parecia não funcionar) e o rótulo do período
caía no cálculo da **semana**, anunciando "3 ago – 9 ago" para uma lista que ia até o dia 31.

**Empty state:** a tela não sabe distinguir "mês sem evento" de "empresa sem obrigação configurada"
sem uma segunda consulta — então **não afirma**. Diz o que é verdade ("Nenhum evento em setembro de
2027"), oferece o próximo mês, e só dentro da empresa lembra onde se configura obrigação. `ehTelaEstreita()` trata largura 0 como *desconhecida*, não como
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

## Município emissor da NFS-e — SELEÇÃO, nunca dedução

Campo no formulário de edição (bloco **Inscrições**, junto da inscrição municipal — os campos que
`buildMissingFields` do emissor exige). Componente: `form/components/SeletorMunicipioIbge.jsx`;
regra em `lib/municipios/municipioIbge.js`; dado em `lib/municipios/municipiosIbge.data.js`
(5.571 linhas, extraídas da API de Localidades do IBGE em 2026-08-14, **versionadas** — nunca
buscadas em runtime; o arquivo diz no cabeçalho como atualizar).

- ⚠ **NADA vem pré-selecionado**, nem para a maioria da carteira que é do Rio. O código do Rio
  (`3304557`) aparece cravado numa regra de IM dentro de `NfseService`; reusá-lo como sugestão
  transformaria detalhe de implementação em afirmação sobre a empresa.
- ⚠ **A busca ENCONTRA, não escolhe.** Um único resultado também não se autosseleciona, e toda
  opção mostra **município E UF** — é a UF que desambigua (há cinco "Bom Jesus" no país). Derivar o
  código do `PortalClient.municipio` (texto) erraria em homônimo, e o erro apareceria só como **nota
  emitida no município errado**.
- O `municipio`/`uf` do cadastro aparece **ao lado, para conferir**; divergência vira **aviso**, não
  correção automática (a empresa pode ter mudado de endereço).
- **A ausência aparece antes da tentativa**, em dois lugares: no cadastro (aviso âmbar dizendo que a
  empresa não emite) e no `EmitirNfseWizard`, que **bloqueia no primeiro passo** — impedimento da
  EMPRESA não pode ser descoberto depois de preencher a nota inteira.
- Onde ele vive: **`legacyCompany.codigoMunicipioIbge`** (coluna de `Company`, não de
  `PortalClient`). Tem de estar em `legacyCompanySelect` (`routes/firm/index.js`), senão volta
  `undefined` e o formulário reabre vazio.

## Emissão de NFS-e — N códigos ESCOLHIDOS, e o municipal ainda digitado

Bloco **"Emissão de NFS-e"** no formulário de edição, logo abaixo de Inscrições (onde o seletor de
município já estava). Componente `form/components/CamposEmissaoNfse.jsx`; regra em
`lib/nfse/cadastroEmissaoNfse.js`. São `codigosServicoNacional` (a LISTA de `cTribNac`),
`codigoServicoMunicipal` (`cTribMun`) e `rpsSerie`.

⚠ **Eles existiam no banco e na API e NÃO existiam em tela nenhuma.** `buildMissingFields` recusava
a emissão por eles e não havia por onde preenchê-los — a mesma classe de defeito do município.

### ⚠ O código nacional virou LISTA (dono, 16/08/2026)

> *"ao cadastrar podemos ter mais de um código (…) e na hora da emissão ela deve escolher (…)
> devemos mostrar o texto para que facilite a escolha."*

`form/components/SeletorServicosNacionais.jsx` + regra em `lib/servicosNacionais/servicoNacional.js`
+ dado em `servicosNacionais.data.js` (**335 códigos + 242 grupos**, extraídos do Anexo B oficial do
portal `gov.br/nfse` em 2026-08-16, versionados com hash em `docs/lista-servico-nacional/` — nunca
buscados em runtime; `import()` dinâmico, fora do bundle inicial).

- ⚠ **A razão do campo digitado deixou de valer.** Estava escrita aqui: *"a lista de serviços da LC
  116 não está neste repositório"*. Agora está, com URL, data, contagem e SHA-256. Mesmo caminho que
  o município fez.
- ⚠ **O `cTribNac` NÃO é o item da LC 116** — é `item+subitem+desdobro`. A lista mostra os
  **desdobramentos**; o nome do item/subitem aparece como **grupo**, que é o que faz a busca
  funcionar (o contador procura "informática", não "análise e desenvolvimento de sistemas").
- ⚠ **A busca ENCONTRA, não escolhe.** Resultado único não se autosseleciona, nada é
  pré-selecionado, não há de-para CNAE→serviço, e toda linha mostra **código E texto**.
- ⚠ **Código gravado fora da forma NÃO some da tela** (volta em `invalidos`, com aviso): sumir faria
  o contador achar que a empresa tem menos códigos do que tem.
- ⚠ **"Qual destes a nota leva"** aparece só quando há **mais de um** — com um só não há escolha a
  fazer, e a tela não pergunta. Com vários e nenhum marcado, a tela **não elege um**: diz o que
  falta, e o backend recusa com `company_codigo_servico_nacional_fora_da_lista`.
  Esse marcador é uma **ponte**: a escolha por emissão ainda não chega ao XML (`buildDpsXml` lê
  `company.codigoServicoNacional` e não há campo de serviço no payload). Um seletor na emissão que
  parecesse funcionar faria a nota sair com o outro código — erro fiscal **silencioso**.
- **Na emissão** (`features/notas/components/ServicoNacionalDaNota.jsx`, passo "Serviço" do
  `EmitirNfseWizard`): aparecem **só os pré-cadastrados**, com a descrição oficial, e a tela diz
  **qual vai** na nota e onde se troca. Com um único código não faz escolher — mas mostra qual é.
- **Compatibilidade:** com a lista vazia, tanto o formulário quanto a tela de emissão caem para o
  campo singular. É o MESMO dado no formato antigo (antes da migration) — sem isso o cadastro
  reabriria vazio e o contador recadastraria.

### ⚠ QUEM PODE EMITIR — o portão do cliente (dono, 18/08/2026)

> *"o acesso a emissão deve ser liberado para o cliente pelo portal do contador"*

Último bloco de **"Emissão de NFS-e"**, depois dos campos: a ordem é a do trabalho — primeiro a
empresa fica configurada, depois se decide se o cliente pode usar essa configuração.
Componente `form/components/LiberacaoEmissaoCliente.jsx`; regra em
`lib/nfse/liberacaoEmissaoCliente.js`. Par mock/real: `setEmissaoClienteNfse`.

- ⚠ **NÃO é campo do formulário.** Não entra em `form`, não passa pelo `onChange` e não é salvo pelo
  "Salvar alterações": no backend é rota própria (`PATCH /firm/companies/:id/emissao-cliente`, gate
  `ACCOUNTANT`+) com auditoria de quem/quando. Um campo a mais faria o ato fiscal viajar junto de
  troca de telefone, e a confirmação perderia o sentido. Vem do payload da empresa
  (`selectedCompany.emissaoCliente`, do `PortalClient`) — **não** de `legacyCompany`: é permissão de
  portal, não configuração fiscal da `Company`.
- ⚠ **TRÊS estados, não dois.** `emissaoCliente` ausente = *"esta tela não recebeu o estado"* e o
  bloco **não renderiza** — não é o mesmo que "não liberada", e desenhar as duas iguais faria o
  contador achar que revogaram a liberação dele. É também o que mantém o bloco fora do cadastro de
  empresa NOVA (não há empresa a liberar antes de ela existir).
- ⚠ **Ligar CONFIRMA repetindo o que vai acontecer** — "os usuários CLIENT_ADMIN e OWNER desta
  empresa passarão a emitir NFS-e em produção, em nome dela", e **nomeia quem continua sem emitir**
  (`FINANCEIRO`). O primeiro clique não envia nada. Revogar também confirma, dizendo que o
  escritório continua emitindo e que as notas já emitidas não são afetadas.
- ⚠ **Verde não entra**, nem no botão de ligar nem no de confirmar (verde é CONCLUÍDO neste app):
  ação primária é o **accent**. Há teste amarrando isso e a ausência de hex literal.
- **"Quem liberou e quando" fica na tela** enquanto está liberada, com as ausências ditas: usuário
  apagado cai no id, data ilegível vira "sem registro da data" — a liberação nunca aparece sem
  autor por omissão.
- ⚠ **`PAPEIS_QUE_PASSAM` é o espelho de `PAPEL_MINIMO_EMISSAO`** (backend). Mudou lá, muda aqui —
  senão a confirmação promete um desfecho e o servidor entrega outro.

### ⚠ A CARGA TRIBUTÁRIA APROXIMADA — o contador digita, o sistema NÃO calcula (dono, 18/08/2026)

> *"precisamos emitir para simples nacional também, as alíquotas efetivas do presumido não precisam
> ser calculadas a não ser o ISS que varia de município, mas deve ser configurado do lado do
> contador, no portal do contador."*

Último bloco de campos de **"Emissão de NFS-e"**, antes do portão do cliente: `pTotTribFed`,
`pTotTribEst` e `pTotTribMun` (colunas novas em `Company`). São os percentuais da **Lei
12.741/2012** que a nota da empresa **não optante** declara ao tomador — o grupo `totTrib/pTotTrib`
da DPS. Regra de tela em `lib/nfse/cadastroEmissaoNfse.js` (`lerPercentualCarga`,
`faltasDaCargaTributaria`).

- ⚠⚠ **O DEFEITO QUE ESTE BLOCO EXISTE PARA IMPEDIR.** O portão do backend usava `.some()`: **um**
  percentual liberava a emissão, e o XML escrevia `0,00` nos outros dois. Configurar só o ISS
  municipal fazia a nota **afirmar carga federal e estadual zero** — impresso ao tomador. Hoje o
  servidor exige os três, e a tela avisa **antes de salvar**, com caixa âmbar, quando só alguns
  estão preenchidos.
- ⚠ **ZERO SE DIGITA, e a tela diz isso.** `0,00` é comum e legítimo (serviço não tem ICMS; a
  NFS-e real versionada declara `pTotTribEst 0.00`). Por isso **nada é pré-preenchido, nem com
  zero** — um zero escolhido pelo sistema seria indistinguível de um conferido pelo contador —, e
  a leitura do que está gravado usa `!= null`, **nunca `||`**: com `||` o zero conferido reabriria
  o formulário em branco, o contador salvaria de novo, gravaria NULL, e a empresa pararia de
  emitir sem nada na tela ter mudado. Mesma armadilha do `?? ""` do `FechamentoModal`.
- ⚠ **O BLOCO RENDERIZA SEMPRE, independente do regime** — e é decisão, não descuido. Quem decide
  o `opSimpNac` da nota é o **`CadastroFiscal`**, com `Company.regimeTributario` só como segunda
  leitura; esconder por `Company.regimeTributario` deixaria a empresa cujo cadastro fiscal diz
  LUCRO_PRESUMIDO com a emissão recusada **e sem campo onde preencher** — a mesma classe do defeito
  que criou este bloco inteiro. O texto diz a quem se aplica (a optante do Simples informa
  `pTotTribSN` na emissão e não usa estes campos).
- ⚠ **NADA É DERIVADO**, e a tela **declara** isso: não há de-para CNAE→presunção aqui (a mesma
  ausência registrada no planejamento tributário), e errar entre 8% e 32% inverteria a comparação.
- ⚠ **`pTotTribMun` NÃO é a alíquota de ISS da nota**, e o campo diz isso: podem coincidir
  numericamente e não são o mesmo dado. Na amostra oficial o ISS aplicado é 5,00% e o
  `pTotTribMun` é 0,00% — no mesmo documento.
- **Vírgula E ponto** são aceitos como decimal (percentual de 0 a 100 não tem milhar). ⚠ Não reuse
  o normalizador de moeda do backend: ele trata ponto como milhar e faria `11.33` virar `1133`.
- ⚠ **A ligação tem teste PRÓPRIO** (`form/components/__tests__/cargaTributariaLigada.test.jsx`):
  o teste do componente sozinho continuaria verde com o `CompanyForm` nunca passando as props —
  que é o defeito favorito daqui. Ele exercita a cadeia inteira: estado inicial →
  `mapCompanyToEditForm` → `<CompanyForm>` renderizando os três campos.

### O municipal e a série

- ⚠ **O `cTribMun` continua DIGITADO**, e agora por um motivo só: **não existe lista nacional de
  códigos municipais** — cada prefeitura publica a sua, e nenhuma está aqui. Valida-se **forma**,
  nunca conteúdo; e a tela **diz** que não confere o conteúdo.
- ⚠ **A série virou "ponto de partida"** (o rótulo mudou junto com o comportamento): ela é lida da
  última nota emitida, inclusive das emitidas fora do portal. Este campo vale na primeira emissão e
  quando a última nota está numa faixa de outro tipo de emissor. Ver `apps/api/CLAUDE.md`.
- ⚠ **NADA é pré-preenchido, nem a série.** `"1"` parece inofensivo e entra no identificador de
  toda nota emitida: um valor escolhido pelo sistema seria indistinguível de um conferido pelo
  contador. Campo vazio é a verdade sobre uma empresa não configurada.
- **A forma, e a fonte de cada uma:** `cTribNac` 6 dígitos (agora provado pela própria lista oficial
  — `item+subitem+desdobro` —, antes por `docs/nfse-preenchimento.md` §5); `cTribMun` só dígitos
  (idem §5); série 1–49999 (RN **E0010**, emissor por aplicativo próprio, espelhando
  `nfseNumeracao.js`). ⚠ A faixa vive nos dois lados por não haver código compartilhado entre front
  e back — se ela mudar no backend, muda aqui.
- ⚠ **O corte dos últimos 3 dígitos do `cTribMun` é ANUNCIADO.** `buildDpsXml` faz `.slice(-3)`;
  sem o aviso o contador informa `10203` e a nota sai com `203`, descoberto depois da emissão. O
  comprimento do código municipal **não está provado** — por isso o campo aceita qualquer tamanho.
- **A ausência aparece em três lugares**, todos antes da tentativa: no formulário (caixa âmbar
  nomeando quais faltam), na **ficha** (bloco próprio, com o aviso) e no `EmitirNfseWizard`, que
  **bloqueia no passo 1** com rótulo, motivo e onde preencher.
- ⚠ **`faltasParaEmitir` é o espelho de `REQUIRED_COMPANY_FIELDS`** (backend), na mesma ordem, com
  teste amarrando as duas listas. Mudou lá, muda aqui — senão a tela promete um desfecho e o
  servidor entrega outro.
- ⚠ **Lê-se de `legacyCompany`, não do topo do payload.** `buildMissingFields` confere a linha de
  `Company`; a `inscricaoMunicipal` do topo é do `PortalClient` e pode estar preenchida enquanto a
  coluna da `Company` não está. **Exceção única: `cnpj`**, que não está no `legacyCompanySelect` e
  só volta no topo — sem esse fallback a ficha acusaria "falta o CNPJ" em toda empresa.
- ⚠ **Prop ausente ≠ cadastro vazio.** `cadastroEmissao={null}` quer dizer "esta tela não recebeu o
  cadastro" e **não bloqueia nada**; tratar as duas como iguais travaria empresa configurada.

### O TOMADOR consulta o CNPJ — ajuda, nunca portão

Pedido do dono (17/08/2026): *"na hora de emitir nota, quando colocamos o tomador, ele deve consultar
o CNPJ"*. Regra em `features/notas/lib/consultaTomador.js` (25 testes), ligação no passo 1 do
`EmitirNfseWizard` (`features/notas/components/__tests__/consultaCnpjTomador.test.jsx`, 13).

⚠ **A chamada é a que já existia** — `consultarCnpj` de `features/onboarding/lib/brasilApi.js`,
importada e **não reescrita**: ela já classifica a recusa em `{ ok, motivo, mensagem }`, já trata a
ausência de `fetch` e já aceita `fetchImpl` (é o que mantém o teste fora da rede — o assistente
recebe isso pela prop `fetchCnpj`). Segundo consumidor de fora do onboarding, ao lado de
`list/components/renderCompaniesTable.jsx`.

- ⚠ **CPF NÃO SE CONSULTA.** 11 dígitos ⇒ **nada acontece**: sem chamada, sem "não encontrado", sem
  piscar, e o botão "consultar Receita" nem aparece. A BrasilAPI é base de CNPJ; perguntar por CPF
  devolveria uma recusa que não significa nada, na tela de quem não errou nada.
- ⚠ **Falha NÃO bloqueia.** Rede fora, 404 ou API caída não entram em `problemasPorPasso`: a recusa
  aparece com a frase "a emissão segue normalmente" e o Continuar fica como estava. É o oposto do
  precedente ruim do erro engolido virando "o botão não faz nada" — aqui a recusa é visível **e** o
  caminho continua aberto. O botão existe para a **retentativa** (a consulta automática não repete
  o mesmo CNPJ; sem ele, uma queda de rede exigiria apagar e redigitar o documento).
- ⚠ **O digitado VENCE**, inclusive numa consulta posterior, e os **dois lados ficam à vista** (com
  botão "usar o da Receita"). A origem sai no rótulo — `da Receita` × `digitado` × ausente, o mesmo
  princípio do planejamento tributário. Sem isso, "por que o nome mudou?" não tem resposta na tela.
- ⚠ **O ENDEREÇO É TUDO OU NADA, e é a decisão que molda o resto.** O validador só aceita o bloco
  completo e o assistente trata endereço **parcial** como problema que trava o passo 1 — então
  preencher 4 dos 5 campos faria uma consulta **bem-sucedida** virar bloqueio da emissão. Faltando
  um pedaço, **nada** é escrito e a tela nomeia o que faltou.
- ⚠ **O `cMun` é aceito por PROVA, nunca por confiança.** Nada de nome→código (homônimo ⇒ nota
  emitida no município errado, a proibição de sempre). O código que a resposta trouxer só vira
  `cMun` se: 7 dígitos **e** existir em `municipiosIbge.data.js` **e** o município/UF dessa linha
  baterem com o `municipio`/`uf` da MESMA resposta. ⚠ O nome do campo na BrasilAPI **não está
  confirmado** por documentação neste repositório — é justamente por isso que a aceitação passa
  pelas três provas; campo ausente ou com outro significado simplesmente não produz código, e o
  endereço deixa de ser oferecido. A lista entra por `import()` dinâmico, só quando há o que
  conferir.
- **Situação cadastral ≠ ATIVA** vira aviso (vem de graça na mesma resposta) — nunca bloqueio.

### O ASSISTENTE virou UMA TELA COM ESPELHO AO VIVO (18/08/2026)

Elevação de UX do `EmitirNfseWizard` ao nível do protótipo aprovado (`prototipos/emissor-notas/`).
⚠ **O que se copiou foi o FLUXO, não a paleta** — o protótipo é claro porque é a cara do CLIENTE; o
portal do contador é escuro e continua lendo `styles/tokens.css`. Nenhum hex novo entrou.

- **Quatro passos viraram DOIS** — `Preencher a nota` (blocos *Para quem · O que · Quanto*) e
  `Conferir e emitir`. ⚠ **Nenhuma garantia caiu junto**: o botão Emitir só existe na conferência, o
  `window.confirm` continua repetindo `linhasDoEspelho` inteira, e o impedimento da EMPRESA
  (município emissor + `faltasParaEmitir`) continua **acima da trilha**, antes de tudo.
- **Espelho ao vivo** (`components/PainelDaNota.jsx`), ao lado do formulário, reagindo a cada tecla.
  ⚠ **Ele NÃO é uma segunda descrição da nota**: sai da MESMA `linhasDoEspelho` que o `confirm` usa.
  Na conferência ele é a tela inteira — a cópia que existia no passo 4 saiu, senão a mesma nota
  apareceria duas vezes lado a lado. Grade em `App.css` (`.emitir-nfse-corpo`), **media query**, não
  `window.innerWidth`; abaixo de 900px o espelho empilha embaixo do formulário e nunca some.
  - ⚠ **`linhasDoEspelho` deixou de escrever "R$ 0,00" para valor ausente.** O espelho passou a ser
    lido com os campos vazios (antes só se chegava nele validado), e zero é AFIRMAÇÃO: dizia que a
    nota vale zero. Hoje é "não informado".
- **Impostos e líquido em destaque** (`lib/tributosDaNota.js`, 20 testes). ⚠ **A única conta é a que
  a tela já afirmava em palavras** (`textoIssRetido`: *"o prestador recebe o valor menos o ISS"*).
  Alíquota em branco **não é alíquota zero** — o ISS fica `null` e vira travessão, com o motivo; e
  **"Não sai do líquido"** nomeia o ISS não retido e o `pTotTribSN`, senão R$ 1.500 de valor com
  R$ 30 de ISS e R$ 1.500 de líquido parece erro de conta.
- **Busca com "encontra, nunca escolhe"** (`components/CampoComBusca.jsx`) em dois campos:
  - **tomador**, a partir das notas que a ABA já carregou (`lib/tomadoresRecentes.js`, prop
    `notasDaEmpresa`). ⚠ **NÃO existe cadastro de clientes neste projeto** — sem modelo, sem rota, e
    inventar um seria construir cadastro fiscal por conta própria. A lista é uma **página filtrada
    por competência**, e o rótulo diz isso; só com `papel: "EMIT"` (em "Recebidas" o tomador é a
    própria empresa).
  - **município do tomador** (`cMun`), que eram **7 dígitos digitados à mão** — errar um emite a nota
    no município errado. Busca na mesma lista oficial versionada do IBGE que o cadastro usa.
  - ⚠ **Resultado único NÃO se autosseleciona** e `Enter` sem item marcado não elege ninguém — é
    onde o componente diverge do protótipo de propósito. Conferido no navegador.
- **A recusa diz o que fazer e leva ao campo** (`lib/rejeicaoDaEmissao.js`, 12 testes).
  ⚠ **`routes/nfse.js` já respondia `{camada, codigo, message, correcao, numeroReutilizavel}` e a
  tela lia só `e.message`** — o "o que fazer" que o backend escrevia era descartado. A `correcao` do
  servidor **vence** qualquer texto local; código nunca visto **não ganha procedimento inventado**.
  - ⚠⚠ **Falha de TRANSPORTE (502) e número indeterminado (409) DESABILITAM o botão Emitir.** Ali o
    desfecho é desconhecido — a nota pode ter sido autorizada do outro lado — e o botão continuava
    clicável depois de qualquer erro. É assim que se duplica nota fiscal.
- **A lista de pendências separa `falta preencher` (cinza) de `corrija` (vermelho).** Juntar os três
  passos faria o assistente **abrir com cinco linhas vermelhas**; campo vazio é o estado normal de um
  formulário recém-aberto. Os dois desabilitam o Continuar igualmente — a cor fala do que fazer.
- ⚠ **O código de serviço por emissão CONTINUA sem seletor, e foi reconferido nesta entrega**:
  `application/validators/nfsePayload.js` não declara campo de serviço e `NfseService.js:540` segue
  lendo `company.codigoServicoNacional`. `ServicoNacionalDaNota` segue dizendo **qual vai** e onde se
  troca. Um seletor que parecesse funcionar emitiria com outro código — erro fiscal silencioso.

### CLICAR NUMA NOTA passou a FAZER alguma coisa (dono, 18/08/2026)

> *"o portal do contador não está habilitado as notas do jeito que lhe disse, como no portal do
> cliente, podendo apenas clicar em uma nota já emitida para copiar dados entre outras coisas"*

O `NotaDetailModal` era uma ficha: dava três coisas para LER e nenhuma para FAZER. Ganhou um bloco
**"O que fazer com esta nota"**, no topo (a ficha é a conferência, vem depois), com duas ações.

**1. Emitir outra a partir desta** — regra em `features/notas/lib/reaproveitarNota.js` (30 testes);
ligação em `notas/components/__tests__/reaproveitarNotaEDanfse.test.jsx` (18).

- ⚠⚠ **NOTA NOVA É NOTA NOVA.** `numero`, `chaveAcesso`, `idNfse`, `idDps`, série/RPS, a
  `competencia` da original, status, ciclo e eventos **não são copiados** — o número da nova é
  reservado pelo BACKEND na emissão. Copiar identificador é duplicidade (**E0014**) ou uma nota que
  se diz ser outra. A invariante é testada por **varredura** do objeto (não campo a campo), senão
  acrescentar `chaveAcesso` "só para a tela mostrar" passaria.
- **Copiado:** documento e nome do tomador, descrição do serviço e valor (`vServ` = `total`).
  **Não copiado, e a tela diz o porquê de cada um:** e-mail e endereço (a nota capturada não os
  guarda — mas o CNPJ preenchido dispara a consulta à Receita, que oferece o endereço), alíquota e
  ISS retido (não os guardamos; em branco vale a da prefeitura), código de serviço (vem sempre do
  cadastro — o da original aparece só para conferência).
- ⚠ **PASSA PELO ASSISTENTE, nunca em volta dele.** O botão só abre o `EmitirNfseWizard`
  pré-preenchido (prop `valoresIniciais`): o bloqueio de cadastro incompleto, o pré-voo do regime, a
  conferência e o `confirm` continuam valendo. Um atalho que emitisse do modal desfaria tudo isso.
- ⚠ **NOTA CANCELADA E SUBSTITUÍDA PODEM SER MODELO — de propósito.** Copiar dados não é reemitir, e
  o caso relatado pelo dono (*"cancelamos essa nota, emitimos outra"*) É o reaproveitamento de uma
  cancelada: a nota errada é o melhor modelo para a certa. O que não pode é a tela **calar**, porque
  aí o contador conclui que (a) emitir daqui "conserta" a cancelada e (b) a nova substitui a antiga
  — e nenhuma das duas é verdade (o payload de emissão não tem campo de substituição). Por isso a
  permissão vem **sempre acompanhada do aviso**, e o de substituída manda conferir se o modelo certo
  não é a substituta.
- ⚠ **Impedem de verdade:** NF-e (este portal não a emite) e nota **recebida** (`papel: "DEST"`, que
  ofereceria a empresa como tomadora dela mesma — mesma razão do filtro das sugestões de tomador).
  Botão impossível **não some**: fica desabilitado com o motivo em **texto**.
- ⚠ **Mais de um item descrito ⇒ descrição VAZIA**, com aviso. A NFS-e tem um `xDescServ` só;
  emendar itens escreveria na nota nova uma frase que ninguém redigiu — e ela sai impressa no
  DANFSe que vai ao tomador.
- O nome copiado entra como `ORIGEM.DIGITADO` (igual à sugestão de tomador): é o que impede a
  consulta de CNPJ — que o próprio preenchimento dispara — de trocá-lo sozinho.

**2. Baixar DANFSe (PDF)** — regra em `features/notas/lib/danfseDaNota.js` (13 testes); par
mock/real `fetchDanfseBlob`.

- ⚠ **A feature inteira existia no backend e NÃO TINHA PORTA NA TELA.** `GET
  /firm/companies/:id/notas/:notaId/danfse` gera o PDF da NT 008 com QR Code e tem 50 testes; até
  aqui `grep -rn "danfse" apps/web/src` devolvia **uma ocorrência, e era um comentário**.
- ⚠ **Não é `<a href>`** — a rota é autenticada e o link não leva o Bearer. Vem por `fetch` com
  Bearer → Blob, o mesmo caminho dos Documentos da empresa e do SITFIS.
- ⚠⚠ **A recusa 503 `danfse_sem_qrcode` APARECE, com o motivo do servidor e o porquê da recusa**
  (*um DANFSe sem QR Code não é um DANFSe*, NT 008 §2.2/§2.4.3). Tela em branco, "falha ao baixar"
  ou download vazio aqui seria a mesma mentira que o 503 existe para impedir.
- **Nota sem `xmlRaw` não gera**, e o botão **diz isso** em vez de sumir. O PDF é **gerado sob
  demanda e nunca salvo** — não há cache a limpar nem "regerar" a oferecer.
- ⚠ **O mock exercita os DOIS caminhos**: `mock-nfse-sem-chave-emit` (nota EMITIDA, com XML e **sem
  chave**) devolve a recusa 503, as NF-e devolvem `xml_indisponivel`, o resto devolve o PDF mínimo.
  Ela precisou ser **acrescentada**: a outra nota sem chave do mock tem `papel: null` e por isso não
  aparece em nenhuma das duas caixas — a recusa ficava inalcançável offline.

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

## Senhas e acessos (`credentials/`) — o cofre da empresa

Aba do grupo **Empresa**, ao lado de Documentos (`/companies/:id/credenciais`). **Duas seções, e a
separação é o ponto:** em cima o COFRE (senha cifrada no backend com o MESMO `encryptSecret` do
certificado A1, nunca listada, revelação auditada); embaixo **Outras informações**, texto livre
**não cifrado**, e a tela diz isso em letras que dá para ler. Um campo que parece cofre e não é vale
menos que campo nenhum.

- **Regra de tela em `credentials/lib/estadoCredencial.js`** (22 testes): o que ocupa o lugar da
  senha, o motivo nomeado do botão desabilitado (do mais específico para o mais geral — "não tem
  senha" ANTES de "você não tem permissão"), o aviso de proteção do ambiente (KMS × variável de
  ambiente × **desconhecido**) e o `estadoDaCarga`.
- ⚠ **Lista vazia diz TRÊS coisas** (`estadoDaCarga`): `VAZIA` (não há credencial) · `RECUSADA` (o
  servidor respondeu não) · `SEM_RESPOSTA` (a chamada não voltou). **O que as separa é `err.status`**
  — `request()` só o carimba quando houve resposta HTTP. Desenhar as três como "Nenhuma credencial
  guardada" faz o contador recadastrar uma senha que existe e que ele só não está conseguindo ver.
  Pelo mesmo motivo a **contagem some no erro**: "0 credencial(is)" é afirmação sobre a empresa.
- ⚠ **A senha revelada vive só em `useState`** (um `Map` por credencial), nunca em
  `localStorage`/`sessionStorage`, nunca em `title`, nunca em atributo, nunca em `console`. Recarregar
  a lista esconde tudo de novo. A revelação é POST (`revealCompanyCredential`, `confirmado: true`) e
  o backend grava a linha de auditoria **antes** de decifrar.
- **Apagar confirma repetindo rótulo E login** — uma empresa tem duas linhas "gov.br" (a do sócio e a
  da empresa) e o login é o que as separa. Apagar informação repete rótulo e valor.
- ⚠ **Ainda NÃO há edição na tela.** `useCompanyCredentials.atualizar` e o par
  `updateCompanyCredential` (mock/real) existem e **não têm chamador** — trocar uma senha hoje exige
  excluir e recadastrar, e a distinção que o backend preserva com cuidado (`senha` ausente = não
  mexer × `senha: ""` = apagar) é inalcançável pela UI.

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

## TRÊS PERGUNTAS, TRÊS COLUNAS

`Empresa · Apuração · Situação fiscal · Guias · Notas · Ação`. A leitura esquerda→direita é o fluxo
de trabalho: *como está o mês?* (nosso) · *como está com o fisco?* (dívida do cliente) · *o que falta
entregar?*

⚠ **Cada célula de indicador tem NO MÁXIMO UM CHIP.** A versão anterior empilhava duas linhas de
status na mesma célula e produzia combinações sem sentido — "Falta apurar" com "Sem pendência" verde
logo abaixo, misturando andamento do mês com relação com a Receita.

**Regime deixou de ser coluna** (vai na 2ª linha da Empresa, junto do CNPJ): é atributo de leitura
ocasional, não indicador de trabalho, e uma coluna inteira roubava largura das três que dizem o que
fazer hoje. Selos de configuração (SERPRO, parcelamento) vão para o **popover do nome** — com **uma
exceção**, abaixo.

⚠ **A tag `A1` FICA na linha, e isso é decisão do dono — não esquecimento.**

O plano de refinamento mandava mover todo selo de configuração para o popover, e foi o que se fez.
O dono reverteu na hora: *"voce tirou a tag de certificado, coloque de volta"*. O motivo tem peso
técnico, não é preferência: **certificado ausente ou vencido faz a empresa parar de receber nota sem
avisar ninguém** — `AdnNotasService` recusa com `NO_COMPANY_CERT`, a captura devolve sucesso com zero
documentos, e o sintoma só aparece semanas depois como "a empresa ficou sem notas". Informação que
some silenciosamente não pode morar atrás de um clique.

A tag segue as duas regras que a mantêm barata: aparece **só na exceção** (`certificado.js` devolve
`rotulo: "A1"` para ausente e vencido) e é **cinza**, badge de configuração — nunca um token
semântico, senão vira mais um vermelho competindo com as três colunas de trabalho.

### `lib/estadoApuracao.js` — o enum que quatro coisas compartilham

`problema → falta fechar → falta apurar → fechada`. Coluna Apuração, chips de filtro do topo e peso
de ordenação saem **todos daqui**. Antes eram quatro cálculos paralelos sobre `travas`, e divergiam
na mesma tela.

⚠ **A barra de progresso SAIU (15/08/2026, decisão do dono: *"tire também aquela barra de progresso
da página principal, está poluindo"*).** Ela era o quarto consumidor deste enum — segmentos
proporcionais em cards e tabela, com "N/M fechadas" ao lado — e o `useMemo` `segmentosProgresso` foi
removido junto, para não deixar cálculo morto. **Chip de filtro e ordenação FICARAM**: só a barra
saiu, e o dado que ela mostrava continua nos chips (`🔒 Fechada · N` e `Todas · N` vêm do mesmo
`contagemApuracao`).

⚠ **"Fechada" é TEAL (`--state-closed`), não verde** — o plano pedia verde. Verde quer dizer
*concluído* no vocabulário de cores; fechada quer dizer **fora do fluxo de trabalho**, que não é a
mesma coisa. Com verde, "guias todas enviadas" e "mês fechado" ficariam indistinguíveis num relance,
e é justamente o mês fechado que sai da lista de trabalho (opacidade 0.6, agrupado no fim).

⚠ **"Falta apurar" é CINZA e só se sai dele com `apuracao.apurada === true`.** `podeFechar` fala do
fechamento CONTÁBIL e não prova apuração fiscal; usá-lo como sinal fazia a carteira inteira nascer
em "Falta fechar" (âmbar) no dia 1 — o paredão de volta, em outra cor. A barra nasce cinza e vai
colorindo (cinza → âmbar → verde): conta a história do mês em vez de gritar o mês inteiro.

### `lib/situacaoFiscal.js` — cinco estados, e o que NÃO envelhece

`Em dia` (sem pill: estado bom não grita) · `Com pendência` · `Parcelamento X/N` (**acento**, não
âmbar — é situação gerenciada, não alarme) · `Parcela atrasada` · `Consultar (Xd)`.

- **Sem contagem de pendências.** Não existe número gravado; ele só sairia do parser heurístico do
  PDF (`verificadoTrial: false`). Decisão do dono: chip sem número, lista no popover.
- ⚠ **Frescor rebaixa só o BOM.** Consulta com mais de `DIAS_PARA_ENVELHECER` (30) vira
  "Consultar (Xd)" — mas **pendência e parcela atrasada não envelhecem**: dívida conhecida não some
  porque a consulta é antiga, e trocá-la por "Consultar" esconderia problema que já sabemos existir.
- ⚠ **O clique CONFIRMA antes de consultar.** SITFIS é **paga**, tem trava de 4h por empresa, e o
  limite do `/Apoiar` é **por contratante** — cliques distraídos numa lista de 30 linhas viram fatura
  e podem travar a consulta de toda a carteira.

### Coluna Guias — agregação

Enquanto **todas** as guias de tributo estão em "falta gerar", vira **um** chip: `⚠ N guias · falta
apurar`. É o antídoto do Lucro Presumido, onde IRPJ + CSLL + PIS/COFINS + ISS davam quatro chips
vermelhos por linha dizendo a mesma coisa. Divergiu o estado, os chips voltam — aí o detalhe informa.
A **parcela nunca entra no agregado** (`ehParcela`): ela não vem de apurar, vem de capturar o
parcelamento. Rótulo `Parcela X/N`; a existência do acordo é assunto da coluna Situação fiscal, e
dizer isso nos dois lugares foi o que duplicou o parcelamento.

### Filtros

⚠ **Nenhum filtro pode estar ativo sem chip removível visível** com o painel fechado — critério
inegociável. O painel antigo escondia o estado atrás de um botão e o contador via a carteira pela
metade sem entender por quê (o "filtro fantasma"). Contagem do botão e chips saem da MESMA lista.
O filtro "Fechamento" **saiu**: duplicava os chips do topo, e dava para os dois se contradizerem.
⚠ O filtro **"Regime" também saiu** (18/08/2026) — quem separa por regime agora são as **abas**
acima da tabela. Saiu INTEIRO: estado, `<select>`, entrada no de-para dos chips, reset e condição
do `useMemo`. Meia remoção é o filtro fantasma de novo.

## Abas de regime + gaveta lateral (dono, 18/08/2026)

> *"ter duas tabelas na página principal, uma para presumido e outra simples nacional, deve ficar
> indicado em cima da tabela, como uma aba de navegador. dessa forma exclua o filtro de regime, pois
> já estarão separados"*

Regra em **`list/lib/abaRegime.js`** (26 testes); a ligação em
`list/pages/__tests__/abasDeRegimeNaCarteira.test.jsx` (24). Reusa **`components/ui/Tabs`**, a única
barra de abas do app, com `mode="view"` (trocar de aba não navega).

- ⚠ **TRÊS ABAS, NÃO DUAS.** `Simples Nacional` · `Lucro Presumido` · **`Outros`**, esta última
  renderizada **só quando há empresa nela**, com a contagem. Medido em produção (18/08/2026): 33
  empresas, 22 `SIMPLES`, 11 `LUCRO_PRESUMIDO`, **zero** fora dos dois — então hoje ela não aparece.
  Com só duas abas fixas, a empresa de `LUCRO_REAL`/`MEI`/`OUTRO` (valores que o cadastro aceita) ou
  **sem regime** sumiria da página principal sem nada dizendo que existe. Dentro de `Outros` a linha
  **nomeia o regime** — e a ausência vira a frase **"Sem regime cadastrado"**, no card e na tabela.
- ⚠ **O critério é o MESMO de `acoesDaSelecao`**: só `SIMPLES` exato é Simples. A leitura é uma só —
  `regimeDe` **mudou de arquivo** (de `acoesDaSelecao.js` para `abaRegime.js`) e é **importada** de
  volta por ele. Foi para lá, e não o contrário, porque `acoesDaSelecao` importa `renderCompanyCard`
  e o card lê o regime: ficando lá, o card fecharia um ciclo de imports.
- **As contagens saem da lista JÁ filtrada** pelos demais filtros. Contar sobre a carteira inteira
  faria a aba prometer 22 e a tabela mostrar 7.
- ⚠ **Trocar de aba PODA A SELEÇÃO pelo MESMO caminho que um filtro poda** — a única mudança foi
  `idsVisiveis` passar a sair da lista da aba. **Mas a poda ficou muda**: `BarraSelecaoEmpresas`
  devolve `null` sem seleção, e ao sair do Simples para o Presumido a poda leva *todas* (nenhuma
  empresa está nas duas abas), então a barra sumia levando o aviso junto. Hoje a MESMA frase é
  renderizada solta (`role="status"`, dispensável) quando não sobra ninguém marcado.
- **A aba ativa PERSISTE** (`localStorage: dashboard:abaRegime`), como `modoVisao`. ⚠ Aba guardada
  que não está mais desenhada (`Outros` esvaziada) cai no padrão via `normalizarAba` — senão a
  escolha salva apontaria para uma aba inexistente e a tabela ficaria vazia sem botão marcado.
- ⚠ **A aba NÃO é filtro:** não vira chip removível e não entra na contagem do botão "Filtros"
  (aquele critério existe contra o filtro *escondido*; uma aba em cima da tabela é o oposto disso).
  Onde ela **tem** de aparecer é no **cabeçalho impresso**, e aparece: `Regime: Lucro Presumido · 11
  empresa(s) · …`.
- ⚠ **Só em Tabela e Cards.** `Ano` e `Calendário` são o outro eixo (o tempo) e não foram tocados —
  a grade anual nem passa por `filteredCompanies`, ela tem busca própria no servidor.
- **A barra "Fechamento do mês" (`contagemApuracao`) NÃO passou a contar por aba**: ela conta sobre a
  carteira inteira, como sempre contou (já não respeita busca nem os filtros do painel). São chips de
  filtro sobre `travas`, não um resumo da lista visível; recortá-los por aba mudaria o significado de
  um controle que ninguém pediu para mudar.
- **Cor:** ponto de categoria (`--accent-cyan` Simples · `--accent-orange` Presumido · `--text-faint`
  Outros), **nunca `--state-*`** — regime não é pendência nem conclusão. A contagem vai no **texto**,
  não no `badge` do `Tabs`: aquele badge é `--state-danger`, e "22" em vermelho diria 22 problemas.

### A gaveta lateral (☰) — o que era "Mais ▾"

> *"retire o botão de envio de e-mails em lote, e coloque o de apuração e de consulta dentro de mais,
> em ferramentas. Pegue a aba de mais e coloque na lateral esquerda, com 3 traços para abrir ela e
> fechar; padrão dela deve ser fechado"*

Na barra do topo sobraram **`Nova empresa`** (accent) e **`Onboardings`**, mais o **hambúrguer**, que
vem primeiro porque a gaveta abre à esquerda.

- **Ferramentas:** Apuração · Consultas · Rotinas · Planejamento. **Configurações:** Obrigações do
  escritório · Configuração SERPRO · Plano de Contas Global · Pendências de e-mail. Mesmos rótulos,
  mesmos handlers — é mudança de LUGAR.
- ⚠ **Nasce FECHADA a cada carregamento** (`useState(false)` cravado, sem `localStorage`): "padrão
  fechado" não é "lembra que eu deixei aberta". Fecha por `Esc`, por clique no fundo e pelo próprio
  botão; o foco entra na gaveta ao abrir e **volta para o hambúrguer** ao fechar.
- ⚠ **Sobrepõe, não empurra** (`.dashboard-gaveta` no `App.css`; largura total em ≤760px, como o
  drawer do calendário): a tabela tem seis colunas e reflui se perder 288px. A largura vem de **media
  query**, não de `window.innerWidth` no primeiro render.
- ⚠ **`SettingsMenu` ficou SEM CONSUMIDOR** e **não foi apagado** — está marcado no arquivo. Mesmo
  tratamento do `DefisNaoDevida.jsx`: apagar componente é decisão à parte.
- ⚠ **`/guides/batch-email` ficou sem porta no dashboard.** A rota, a página e o handler do `App.jsx`
  continuam de pé; o que sumiu foi o único link para ela. A prop `onOpenBatchEmail` chega à página e
  **não tem mais uso** (marcada no código, não removida).

## A LINHA da tabela: quatro regras que vivem em `list/lib/`

Card e tabela contam a MESMA história. Cada regra abaixo já existiu em duas cópias, e em cada caso a
mesma empresa apareceu de dois jeitos dependendo da visão.

| Regra | Onde | O que se corrigiu |
|---|---|---|
| Estado dominante + ordenação | `lib/estadoDominante.js` | — |
| Situação fiscal da 2ª linha | `estadoDominante.situacaoFiscalDaEmpresa` | ver abaixo |
| Empresa zerada não tem guia | `estadoDominante.empresaSemObrigacoes` | a regra existia só no card; a tabela mostrava seis chips vermelhos na mesma empresa |
| Certificado A1 | `lib/certificado.js` | o filtro olhava só a PRESENÇA, então empresa com A1 **vencido** — a que não captura NFS-e — caía em "com certificado" |

### Coluna Status: a situação fiscal ocupou o degrau do check-list

A cascata é `Fechada → ⚠ Pendência → ⚠ Pendência fiscal → Falta apurar → Zerada → Pronta p/ fechar`,
e `ORDEM_URGENCIA` ordena a lista por ela.

- **Só `COM_PENDENCIA` ocupa o degrau.** Regular, em parcelamento, processando e nunca consultada
  não exigem ação e não podem passar na frente de "falta apurar" — "✓ Sem pendência" como estado
  dominante de uma empresa que ninguém apurou troca informação útil por informação que engana. Esses
  valores aparecem na **segunda linha** da célula, discretos.
- ⚠ **`fiscalSituacao: null` NUNCA lê como "sem pendência".** Vira `○ Fiscal não consultada`
  (`chaveSituacaoFiscal` → `NAO_CONSULTADA`, em `lib/vocabulario.js`). Afirmar algo sobre o fisco sem
  ter consultado é o erro caro; um círculo vazio é o barato.
- **O sinal do check-list não se perdeu:** o chip de filtro `☐ Falta check-list · N` e o fechamento
  em lote leem `contagemTravas` / `trava.checklistPendentes` direto, não `estadoDominante`.

### A linha NÃO navega

Só o botão **Acessar** abre a empresa — no mouse e no teclado. Com chips, popovers e botão de enviar
e-mail na mesma linha, clicar em qualquer ponto virava navegação por acidente. As setas ↑↓ continuam
movendo o foco entre linhas (isso é leitura), e o clique no **nome** abre o popover de configuração.

### Imprimir

⚠ **A regra de impressão não é mais só da listagem.** `body.imprimindo-listagem` virou
**`body.imprimindo`**, e a Circular reusa o mesmo bloco `@media print` (a segunda cópia divergiria
na primeira correção). Quem quiser imprimir marca `data-print-area` e liga a classe no `body`.

Botão ao lado do seletor de visão. Ele **força a visão Tabela e expande as fechadas** antes de
`window.print()` — as fechadas ficam colapsadas na tela de propósito, e imprimir assim entregaria uma
lista incompleta **em silêncio**. Por isso o clique só liga a flag `imprimindo`; quem chama
`window.print()` é um efeito, depois do render.

O estilo vive num bloco `@media print` no `App.css`, todo com **`!important`** — é a única alavanca
da cascata contra os ~2.200 `style={{}}` inline; sem ele o fundo escuro vai para a impressora.
Marcadores no DOM: `data-print-area` (o que sai), `data-print-only` (cabeçalho do papel, escondido na
tela), `data-print-tabela` (zera `overflow`/`max-height`), `data-coluna-acao` (some no papel).
⚠ O cabeçalho impresso lista **os filtros ativos** — folha filtrada que não diz que está filtrada
mente por omissão.

## SELEÇÃO NA TABELA — as funções em lote passaram a dizer PARA QUEM

> Pedido do dono: *"podemos aderir as funções de, por exemplo, enviar email em lote, à tabela,
> selecionando as empresas e enviando todas as guias que nessas empresas estão contidas"*.

O defeito foi nomeado pelo próprio plano de UI que ele trouxe: *"'Envio de e-mails em lote' não diz
para quem vai enviar"*. As operações rodavam sobre "todas as empresas" ou sobre uma lista que o
contador **não via**.

Peças: caixa por linha + "selecionar todos" em `list/components/renderCompaniesTable.jsx`, regra
pura em **`list/lib/acoesDaSelecao.js`** (32 testes), barra + prévia em
**`list/components/BarraSelecaoEmpresas.jsx`**. Estado da seleção mora na **página**
(`renderCompaniesHomePage`), junto do filtro que a recorta e da `api` que a executa.

⚠ **ISTO CONTINUA SENDO UM SEGUNDO CAMINHO** — mas a barra do topo mudou em **18/08/2026**, por
decisão do dono: `Apuração` e `Consultas` foram para a **gaveta lateral (☰)** e o botão
**`Envio de e-mails em lote`** (o que abria `/guides/batch-email`) **saiu da barra**. Enviar guia em
lote segue por aqui (seleção na tela) e, guia a guia, por "Liberar ao cliente" dentro da empresa —
saiu o BOTÃO daquela página, não a função. Ver "Abas de regime e gaveta lateral", abaixo.

⚠ **NENHUMA ROTA NOVA.** As cinco já existiam e já ganharam escopo de carteira (`idsDaCarteira`,
commit `edc5d468`): `guides/batch-send` · `apuracao/batch` (+`run-now`) · `notas-captura` ·
`notas-download` · `sitfis-download`. O acompanhamento da fila de apuração reusa o
**`BatchProgressModal`** da página Apuração — é ele que faz o `run-now` quando o worker está OFF.

### "Selecionar todos" respeita o FILTRO, e o rótulo diz o número

`companies` chega **filtrado** à tabela, então "todos" é o recorte. Com "○ Falta apurar · 4" na
tela o rótulo é *"Selecionar as 4 empresas desta lista"* — conferido no navegador. As **fechadas
entram mesmo colapsadas** (são linhas desta lista), e por isso o rótulo acrescenta *"(N no grupo
Fechadas, recolhido)"* em vez de deixar o contador descobrir depois.

### Seleção × filtro: PODADA, nunca sobrevivente — e a poda não é silenciosa

Seleção que sobrevive a um filtro pode mandar guia para empresa que o contador não está mais vendo.
Apagar tudo a cada tecla da busca também não serve. Então: a seleção é **podada para o que está na
lista** (nunca sobra id invisível), e a barra **diz quantas saíram**. Limpar o filtro depois mantém
marcadas as que continuam visíveis.
⚠ **Trocar a COMPETÊNCIA limpa tudo** — guias, apuração e situação fiscal são por mês, e uma seleção
feita olhando julho, executada em agosto, manda a guia errada. Aqui não há meio-termo.

### Ação que não se aplica NÃO SOME — e o motivo é TEXTO, não `title`

`planoDaSelecao` devolve, por ação, `alvos` · `fora[{razao, motivo}]` · `disponivel` · `motivo`.
Motivos nomeados: **Lucro Presumido/Real** (o portal não apura), regime **não cadastrado** (não se
afirma nem que apura nem que não), **já apurada** (reapurar = retificadora), **sem A1 / A1 vencido**
(o ADN recusa com `NO_COMPANY_CERT`), **nunca consultada** (não há SITFIS salvo para zipar).
⚠ `title` não conta: não é descobrível, some ao mover o mouse e não existe no toque.

⚠ **Regra 5 ligada no indicador que já existe:** com `useBackgroundJobs().total > 0` as ações que
criam JOB travam com o motivo. O envio de e-mail **não** trava por isso — é chamada bloqueante e
nunca aparece em `/firm/jobs/ativos`. E aquele contador é **global, não escopado por carteira**:
ele pode acender por lote de outro usuário, por isso o texto diz "há processo rodando".

### ⚠ O NÚMERO DO ENVIO SAI DE `batch-report`, NUNCA do `guideCompliance`

A confirmação repete os dados — *"Enviar 8 guias de 3 empresas, competência 07/2026?"* — e esse
número vem de `GET /firm/guides/batch-report` (`pendingGuideIds`), que é **a mesma leitura que
`batch-send` consome**. O `guideCompliance` da listagem é outro caminho e pode estar velho na tela.

- ⚠ **Relatório que não carrega BLOQUEIA o envio.** Sem prévia não há número a repetir, e
  confirmação sem número é o "tem certeza?" que a regra proíbe. Não se mostra o número da listagem
  no lugar: dois números para a mesma pergunta é o defeito que o projeto passa o dia matando — pelo
  mesmo motivo o **botão do envio não tem contador**, só as outras quatro (essas contam sobre dado
  que só a listagem tem: regime, certificado, `fiscalCheckedAt`).
- ⚠ **A leitura local NÃO GATEIA o envio.** Enquanto gateava, um `guideCompliance` velho ("todas já
  enviadas") trancava a porta ANTES de o relatório poder ser lido. Hoje ela só empresta o **motivo**
  mais específico ("empresa zerada", "falta apurar") a quem o relatório já pôs de fora — e **quem
  decide quem entra é o relatório**. Somar as duas listas punha a MESMA empresa em "Entram" e em
  "Ficam de fora" ao mesmo tempo (visto na tela).
- ⚠ **Prévia que resolve para zero não pergunta "enviar 0 guias de 0 empresas?"** — pergunta sobre
  nada, e que ainda parece defeito de contagem. Afirma o desfecho e lista os motivos.

⚠ **`pendingGuideIds` do MOCK estava mentindo** e o conserto foi junto (`mockApi.js`): o backend
empurra para lá **toda** guia não-`SENT` e não-`VAZIO`; o mock só empurrava a **parcela** (o único
`push` do arquivo). Ficou invisível enquanto ninguém lia o campo — a página de envio em lote monta
a seleção por `tiposGuias`. Assim que a prévia passou a contar por ele, o mock respondeu "0 guias"
numa tela cheia de guias. Hoje o campo é **derivado** de `tiposGuias`, com o mesmo critério do real.

### ⚠ O `sitfis-download` NÃO é a consulta paga — o plano do dono dizia que era

O inventário que veio com o pedido listava `POST /firm/sitfis-download` como *"consulta PAGA, trava
de 1× a cada 4h"*. **Medido: ele zipa o PDF já armazenado e não fala com o SERPRO.** A consulta paga
(com a trava de 4 h por empresa e o limite AV02 **por contratante**) é
`POST /firm/companies/:id/serpro/sitfis/relatorio` — e ela **não** entrou na barra de seleção:
o caminho por empresa continua no botão "Consultar" da própria linha, e o lote pago continua em
**Consultas → Situação Fiscal**, onde `usePendencias.consultarLote` já espaça as chamadas e para
depois de 3 limites seguidos. Um segundo disparador de consulta paga, sem essa cadência, era o risco
que a regra existe para impedir. `HORAS_TRAVA_SITFIS` vive em `acoesDaSelecao.js` só para a prévia
poder **nomear** quem está dentro da janela — o backend continua sendo a autoridade.

## Padrões

- Componentes recebem dados/handlers por props; estado de workspace em
  `app/hooks/useManageCompaniesWorkspace.js` (expõe `dashboardCompetencia` +
  `changeDashboardCompetencia`).
- Toda chamada nova precisa de par mock/real em `src/api/`.
