# CLAUDE.md — Web (apps/web)

Frontend React 19 + Vite + TailwindCSS.

## Estrutura

```
src/
  api/
    mock/
      mockApi.js        - Implementação mock para desenvolvimento offline
    real/
      realApi.js        - Chamadas reais à API backend
    index.js            - Exporta a implementação ativa (mock/real/fallback)
  features/             - Módulos por domínio
    auth/
    companies/
      pages/
        CompanyDetailPage.jsx
    guides/
    accounting/         - Lançamentos contábeis (em andamento)
      components/
      hooks/
    fiscal/
      serpro/           - Página de configuração SERPRO (credenciais, cron, cert)
      sitfis/           - Situação Fiscal (SITFIS): useSitfis + aba (PDF em iframe + download)
    pendencias/         - Página top-level "Pendências" (fiscal/SITFIS): individual + lote
  components/           - Componentes genéricos reutilizáveis
  lib/                  - Helpers, hooks globais
  styles/               - CSS global
  App.jsx
  main.jsx
```

## Modo de API (mock / real / fallback)

O frontend suporta três modos controlados por variável de ambiente:

| Modo       | Comportamento                              |
|------------|--------------------------------------------|
| `mock`     | Usa `mockApi.js` — sem backend necessário  |
| `real`     | Usa `realApi.js` — chama a API real        |
| `fallback` | Tenta real, cai para mock se falhar        |

- Toda feature nova deve ter implementação em **ambos** `mockApi.js` e `realApi.js`
- Manter contratos de resposta idênticos entre mock e real

## Padrões

### Features

- Cada feature fica em `src/features/<dominio>/`
- Estrutura interna: `pages/`, `components/`, `hooks/`
- Pages são componentes de rota (conectam ao estado e chamam a API)
- Components são puros/apresentacionais sempre que possível

### Chamadas à API

```js
// Sempre via camada de api, nunca fetch direto em componentes
import { api } from '@/api';

const data = await api.getAccountingEntries(companyId);
```

### ⚠ Feedback: passe o objeto INTEIRO, nunca `{message, error}`

`useManageAppFeedback` expõe `message`/`error` **e** `notifySuccess`/`notifyError`/`notifyInfo`.
Várias features chamam `feedback?.notifyError?.(…)` — com a função ausente isso é **no-op
silencioso**, e o optional call não deixa nem um erro no console.

O `App.jsx` remontava o objeto como `{ message, error }` ao passar para a página de detalhe da
empresa. Resultado: **todo** erro do `FechamentoModal` (SERPRO, cert do escritório não configurado,
apuração zerada com faturamento, timeout) sumia sem uma linha na tela — o sintoma era "o botão
Calcular não faz nada". O backend nunca engoliu nada; era o front que descartava.

Regra: `feedback={feedback}`. Se precisar restringir, restrinja no componente, não na passagem.

### Estado

- Preferir estado local (`useState`) para UI efêmera
- Estado compartilhado entre rotas: Context API ou prop drilling consciente
- Não adicionar Redux ou Zustand sem discutir antes

### Roteamento

⚠ **Não existe `<Routes>` no `App.jsx`.** O React Router está montado (o app usa `useLocation` /
`useNavigate`), mas o despacho é uma **cadeia de `if (session.page === …)`** dentro do `App.jsx`; o
`page` sai de `pathToPageName(location.pathname)` em `useManageAuthSession.js`. Quem procurar por
`<Route>` para entender a navegação não acha nada.

- ⚠ **Aba de navegação da EMPRESA é `<a href>`** desde 19/08/2026 (Ctrl+clique abre em nova guia).
  O `href` sai de `companyTabPath` (`features/companies/detail/lib/rotasDaEmpresa.js`), a MESMA
  fonte que a navegação usa. `Tabs` só honra `href` em `mode="nav"`: as abas de VISÃO
  (`mode="view"`) não têm URL e continuam `<button>`. Detalhes em `features/companies/CLAUDE.md`.
- **Página nova = duas peças**: entrada em `PAGE_TO_PATH` + `pathToPageName`, **e** o bloco `if`
  correspondente no `App.jsx`. Só a primeira metade não dá erro: a URL cai no fallback
  (`companies`) em silêncio, que foi o destino de `/calendario` e `/pendencias` por um tempo.
- Proteção: `ensureSession()` manda pro `/login` sem token; não há wrapper de rota.

### Estilo

⚠ **NÃO existe Tailwind neste projeto.** Não há `tailwind.config`, nem a dependência, nem as
diretivas no CSS — a afirmação anterior era herdada de scaffold e fazia qualquer um escrever
`className="flex gap-2"` para nada renderizar.

O que existe são **três camadas**, nesta ordem de preferência:

1. **`src/styles/tokens.css`** — as design tokens (cores, espaçamento, raio). É a fonte da verdade;
   `index.css` já a importa. **Cor nova entra aqui, não no componente.**
2. **`App.css`** — layout e componentes de esqueleto (`.company-tile`, `.cards-grid`, `.btn*`).
   Consome os tokens via `var(--…)`.
3. **`style={{}}` inline** — é o sistema de fato no resto do app (~2.200 objetos). Aceitável, desde
   que os **valores venham de `var(--…)`**, não de hex literal.

**Tokens de ESTADO têm significado fixo** (`--state-danger` bloqueia o fechamento, `--state-warn` é
ação rápida, `--state-ok` concluído, `--state-neutral` é o padrão). Usar um fora do seu significado
recria o problema que o redesign resolveu: quando quase tudo é vermelho, nada se destaca.

⚠ Todo token de estado tem par **`-surface`**. Não derive fundo com `` `${cor}22` `` — concatenação
de hex quebra em silêncio assim que a cor vira `var(--…)`.

- Não criar arquivos CSS por componente
- Componentes de UI reutilizáveis ficam em `src/components/`

#### ⚠ OS PRIMITIVOS (20/08/2026) — use, não recrie

A camada certa existia e quase nenhuma tela a usava. Medido antes desta entrega: **841** hex
literais em 82 arquivos, **43** overlays de modal escritos à mão em 33 arquivos (com doze
larguras), **12** pares `const th/td` inline sobre um `table/th/td` que o `App.css` já estiliza,
**4** componentes `Aviso` locais além do "único", e a moldura da aba da empresa repetida **16
vezes** no mesmo arquivo. O sintoma que o dono viu foi a LARGURA: `1100` na ficha, `900` no cofre
e nas anotações, `1400` no SITFIS, `--content-wide` em Documentos — trocar de sub-aba fazia o
conteúdo saltar.

| Primitivo | Onde | Para quê |
|---|---|---|
| `CompanyTabLayout` | `features/companies/detail/components/` | a moldura de TODA aba da empresa (header + largura + Feedback + Suspense) |
| `Painel` | `components/ui/Painel.jsx` | seção com título — envolve a classe `.panel` que já existia |
| `Modal` | `components/ui/Modal.jsx` | `sm` 460 · `md` 640 · `lg` 900; Esc, fundo, foco que volta ao gatilho, Tab preso |
| `.tabela--densa` / `.tabela__num` | `App.css` | o que faltava para a tela parar de mandar `th`/`td` inline |
| `.form-actions--fixa` | `App.css` | barra de ação que gruda no rodapé do formulário |
| `Aviso` | `components/ui/Aviso.jsx` | ganhou `icone` e `acao`; a trava (tom inválido → `neutro`) não mudou |
| `LogoAltan` | `components/ui/LogoAltan.jsx` | a marca, SVG **inline**. `altura` manda; `tom="papel"` para impressão |

- ⚠ **DUAS LARGURAS, E SÓ DUAS:** `leitura` (`--content-max`) e `trabalho` (`--content-wide`), mais
  `cheia` para quem já é uma tela inteira por dentro (Lançamentos, Circular). Largura desconhecida
  cai em `cheia`, **nunca** numa das contidas — espremer uma tabela de 12 colunas é um defeito
  invisível; ficar larga demais é visível e barato. Largura nova entra em `tokens.css`, ou não entra.
- ⚠ **`Modal` com `ocupado` desliga as três saídas de uma vez, o ✕ inclusive** — botão que não faz
  nada é pior que botão ausente. E é o CORPO que rola, não a caixa: nos modais à mão o `overflow`
  era da caixa e o botão de confirmar ficava abaixo da dobra do próprio diálogo.
- ⚠ **A migração dos outros ~40 modais é incremental.** Não apague modal existente sem migrar.
- ⚠ **O `Modal` põe o foco no CORPO, não no ✕**, e respeita o `autoFocus` do conteúdo: `.modal-topo`
  vem antes no documento, então "o primeiro focável" era sempre o botão Fechar — num diálogo cujo
  Fechar DESCARTA o que a pessoa arrastou. E com zero focáveis (o estado de `ocupado`) o trap de Tab
  **prende o foco na caixa** em vez de deixar passar: é justamente quando o diálogo diz estar
  travado. Travado em `components/ui/__tests__/modal.test.jsx`.
- ⚠⚠ **`position: sticky` NÃO FUNCIONA EM ITEM DE GRID**, e o `.form-actions--fixa` pagou por isso:
  o bloco contenedor de um item de grid é a própria ÁREA da célula, dimensionada ao conteúdo, e o
  curso de deslocamento é ZERO. Por isso o formulário da empresa é `.company-form` (bloco) com a
  grade num `<div>` interno. Devolver `.form-grid` para o `<form>` desliga a barra em silêncio.
- ⚠⚠ **RECOLHER NOTA DE RODAPÉ NUM `<details>` EXIGE ABRI-LO EM JAVASCRIPT ANTES DE IMPRIMIR** —
  **o CSS sozinho NÃO faz isso**, e esta linha já disse o contrário uma vez.
  Medido no navegador: o Chrome não esconde o conteúdo de um `<details>` fechado com `display:none`
  nos filhos; ele usa `content-visibility: hidden` no pseudo `::details-content`
  (`getComputedStyle(d, "::details-content").contentVisibility === "hidden"`). Uma regra
  `@media print` mexendo no `display` dos filhos é **no-op**, e o papel sai sem a ressalva, sem
  erro nenhum na tela.
  O único lugar que faz certo hoje é o efeito de impressão de
  `apuracao-v2/components/RelatorioFaturamentoPanel.jsx` (`d.open = true` nos `details` de dentro
  de `[data-print-area]`, restaurado no cleanup). As regras do `@media print`
  (`::details-content` + `display: revert`) são **reforço**; nenhuma delas é garantia.
  ⚠ Os outros três `data-print-area` do app (Circular, Planejamento, listagem da carteira) **não
  têm** essa lógica. Tela nova que recolha ressalva precisa repetir o efeito.
- ⚠ **`#6b7280` está proibido como tinta de texto** e apareceu duas vezes nesta entrega (rótulos da
  ficha, ajuda das seções do formulário): mede **3,10:1** sobre `#24253a`, abaixo do mínimo 4,5:1 da
  WCAG AA. `--text-faint` (#8794C9, 5,79:1) existe exatamente para isso. `#8A8FA3` também não
  passa (4,44:1 sobre `#282A36`) — use `--text-muted`.

⚠ **Verde é CONCLUÍDO — nunca use verde em botão de ação primária.** Um botão verde de "faça isto"
ensina o contrário exatamente nas telas onde o verde precisa ser lido como "está fechado" (o rodapé
`D = C ✓ ok`, a guia paga, a obrigação entregue). Ação primária é o **accent**. Pelo mesmo motivo,
âmbar é "pendência", não decoração: um menu permanentemente âmbar (era o caso do SERPRO) treina o
olho a ignorar a cor que significa "falta enviar".

⚠ **Impressão é uma regra só, compartilhada:** bloco `@media print` no `App.css`, ligado por
`body.imprimindo` + `data-print-area` (mais `data-print-only` e `data-print-tabela`). Todo
`!important` ali é proposital — é a única alavanca da cascata contra os ~2.200 `style={{}}` inline.
Tela nova que precise imprimir **reusa**, não copia.

## ⚠⚠ A MARCA (23/08/2026)

Até esta data o favicon deste portal era **`/vite.svg`** — o logo do Vite, do scaffold — e a aba
dizia **"Portal Firm"**, em inglês. Hoje: favicon próprio, `<title>` "Altan Contabilidade —
Escritório", a logo no login e no cabeçalho dos impressos.

- ⚠⚠ **SVG INLINE, NUNCA `<img src>`** (`components/ui/LogoAltan.jsx`): o letreiro é `<text>` na
  fonte Inter, e um SVG usado como imagem não enxerga as fontes da página. A Inter é
  **auto-hospedada** em `public/fonts/` (variável, 48 KB). ⚠ `--font-sans` **não mudou** — só a logo
  usa Inter.
- ⚠⚠ **NOS IMPRESSOS A LOGO VAI COM `tom="papel"`, e isto não é detalhe.** Este portal é escuro: a
  tinta dele (`--logo-tinta` = `#F8F8F2`) sairia **invisível no branco da folha**. A variante crava o
  par de fundo claro e liga `print-color-adjust: exact`, senão o navegador descarta a cor da cúpula.
- ⚠⚠ **E ela precisa estar DENTRO do `[data-print-area]`.** A regra é
  `body.imprimindo > * { visibility: hidden }`, e só os descendentes da área voltam a ser visíveis —
  uma logo fora dela simplesmente não sai no papel. Ela entrou no `[data-print-only]` que cada área
  já tinha: Circular, Relatórios, Planejamento, Relatório de Faturamento e a listagem da carteira.
- ⚠ **O `EspelhoDefis` ficou de fora**, e o motivo é anterior a esta entrega: o botão "Imprimir o
  espelho" chama `window.print()` **cru** — não liga `body.imprimindo` nem declara `data-print-area`,
  então nem o mecanismo compartilhado ele usa, e um `[data-print-only]` ali seria invisível.
- ⚠⚠ **O LOGIN SÓ DIZ O MODO QUANDO É `mock`.** Ele imprimia `Modo da API: real` na tela de entrada
  do contador. A comparação é `=== "mock"`, **nunca `!== "real"`**: são TRÊS modos, e
  `real_with_mock_fallback` **fala com o backend de verdade** — chamá-lo de demonstração diria que
  números de produção são fictícios. Experimento executado: com `!== "real"`,
  `__tests__/logoEModoNaEntrada.test.jsx` fica 1 vermelho.
- ⚠ **`vite.svg` e `src/assets/react.svg` foram apagados** — o primeiro deixou de ser referenciado,
  o segundo nunca teve um importador.

## ⚠⚠ A ABA NOTAS FISCAIS ENXUGOU (23/08/2026)

Três pedidos do dono, com a tela na frente, no mesmo dia.

**1. A faixa "Notas recebidas" foi ABSORVIDA pela faixa de resumo** (*"isso aqui tá horrível (…)
tem que ser absorvido para junto das outras caixas; pode aparecer recebidas, ao lado recebidas NF-e
e recebidas NFS-e"*). Eram duas faixas empilhadas, com duas caixas dizendo o MESMO número com nomes
diferentes. `RecebidasResumo.jsx` foi **apagado**, não deixado sem chamador.

- ⚠⚠ **A ARMADILHA DA FUSÃO, e ela é invisível hoje:** as duas faixas NÃO falavam da mesma
  população. São duas chamadas a `/notas/summary` — `summary` leva o `type` da janela (**uma**
  espécie) e `recebidas` leva `papel: "DEST"` **sem** `type` (**as duas**). Elas coincidem só
  enquanto a empresa não tem NF-e recebida. As três caixas de recebidas saem TODAS da segunda.
- ⚠ **"Recebidas" não é clicável**: o valor é das duas espécies e a tabela mostra uma; um clique
  filtraria metade do que a caixa afirma. A ação antiga não se perdeu — "Recebidas NFS-e" na janela
  de NFS-e faz exatamente o mesmo que o filtro por papel fazia.
- ⚠ A contagem somada foi para o SUBTÍTULO de "Recebidas" (`21 nota(s) · NFS-e + NF-e`) em vez de
  uma sexta caixa: ela foi pedida pelo dono antes e continua na tela, com o rótulo que impede o
  número de ser lido como uma coisa só.

**2. O seletor "Produção / Homologação" SAIU DA TELA**, nos DOIS painéis de captura
(`AdnCapturePanel` e `DfeCapturePanel`) — deixar num só faria duas janelas irmãs discordarem.

- ⚠ O `env` **continua no contrato** (`onSync({ env: AMBIENTE })`, cravado em `"prod"`). Tirar o
  parâmetro junto obrigaria a mexer no backend por causa de uma mudança de LAYOUT.
- ⚠⚠ **O que se perdeu é real:** não há mais como disparar captura em HOMOLOGAÇÃO pela interface.
  É coerente com a tela — ela é a rotina diária sobre dados de produção, e nota de homologação
  entrando aqui contamina a base que a apuração lê. Se for preciso, o lugar é a engrenagem.

**3. O aviso "Última busca há 2h…" ficou mais discreto** — desceu para uma linha abaixo do botão,
em `--text-faint` e 0,72rem.

- ⚠⚠ **Ele NÃO virou `title`**, e isso é deliberado: `title` não aparece no teclado nem no toque. A
  frase carrega o que a ausência de notas não carrega — *"sem nota na tela, o contador precisa saber
  se ninguém olhou, se olharam e não veio nada, ou se deu erro"*. Discreto é ficar mais quieto, não
  sumir. ⚠ O texto de ERRO continua na barra, em vermelho: esse não é para ficar quieto.

⚠ **O `CLAUDE.md` de `features/notas/` que a raiz cita NÃO EXISTE** — a referência é anterior a esta
entrega e continua pendurada.

## ⚠⚠ TREZE ARQUIVOS DESTE APP TÊM CÓPIA NO PORTAL DO CLIENTE

`apps/web` e `apps/portal-cliente-web` são dois frontends **sem código compartilhado**, e a
duplicação é deliberada. O que não era deliberado é o silêncio: **até 24/08/2026, 12 dos 13
originais não diziam ter cópia** — quem editasse `valorDaNota.js` aqui não tinha um sinal sequer de
que existe outro portal lendo a mesma regra. Hoje cada um abre com um bloco `⚠⚠ ESPELHO`, dizendo o
caminho da cópia **e o que diverge nela**.

⚠ **A TABELA CANÔNICA CONTINUA SENDO UMA SÓ**, e mora em `apps/portal-cliente-web/CLAUDE.md`
("mudou lá, muda aqui"). Duas tabelas divergiriam pelo mesmo motivo que os módulos divergem.

Os originais que carregam o aviso:

| aqui | a cópia |
|---|---|
| `src/features/notas/lib/valorDaNota.js` | `features/emitir/lib/valorDaNota.js` |
| `src/features/notas/lib/consultaTomador.js` | `features/emitir/lib/consultaTomador.js` |
| `src/features/notas/lib/reaproveitarNota.js` | `features/emitir/lib/reaproveitarNota.js` |
| `src/features/notas/lib/descricaoSugerida.js` | `features/emitir/lib/descricaoSugerida.js` |
| `src/features/notas/lib/danfseDaNota.js` | `features/notas/lib/danfseDaNota.js` (⚠ contratos DIFERENTES) |
| `src/lib/nfse/cadastroEmissaoNfse.js` | `features/emitir/lib/cargaTributaria.js` (⚠ parcial: só `lerPercentualCarga`) |
| `src/features/guides/lib/rotuloGuia.js` | `features/guias/lib/rotuloGuia.js` (⚠ amarrado por teste) |
| `src/features/guides/lib/linhaDigitavelTela.js` | `features/guias/lib/linhaDigitavelTela.js` |
| `src/features/fiscal/sitfis/components/SitfisRelatorioTabela.jsx` | `features/fiscal/RelatorioSitfis.jsx` |
| `src/features/onboarding/lib/brasilApi.js` | `api/real/brasilApi.js` |
| `src/components/ui/cliqueDeLink.js` | `lib/cliqueDeLink.js` |
| `src/components/ui/LogoAltan.jsx` | `components/LogoAltan.jsx` |
| `src/components/ui/BotaoCopiar.jsx` | `components/ui.jsx` (`BotaoCopiar`) |

⚠⚠ **O CUSTO DE ESQUECER JÁ FOI MEDIDO.** O `reaproveitarNota.js` ficou **cinco dias** divergindo em
silêncio: a decisão do dono de 19/08/2026 (copiar o valor da nota de origem) foi aplicada aqui e a
cópia ficou com a guarda de 18/08, recusando nota que este aceita — a MESMA nota abrindo o
formulário de um lado e sendo recusada do outro. Ninguém reporta esse defeito; só desconfia.

## ⚠ OS CINCO ÓRFÃOS (medidos em 24/08/2026)

Cinco componentes deste app **não são importados por arquivo nenhum** — varredura do nome exportado
em todo o `src`, testes inclusive, zero consumidores. Cada um carrega o aviso no próprio cabeçalho.

| arquivo | último commit que o tocou | o que se sabe |
|---|---|---|
| `features/firm/settings/pages/renderFirmSettingsHubPage.jsx` | 02/07/2026 | as configurações que ele reunia têm porta própria no dashboard hoje — ele foi CONTORNADO |
| `features/guides/settings/pages/renderGuideSettingsPage.jsx` | 19/05/2026 | o mais antigo; 27 linhas |
| `features/notas/components/CompetenciaDetailPanel.jsx` | 09/08/2026 | ficou de fora quando a aba Notas Fiscais enxugou (23/08) |
| `features/notas/components/ProcuracoesPanel.jsx` | **25/08/2026** | idem |
| `features/notas/components/ReabrirCompetenciaModal.jsx` | **25/08/2026** | idem — ⚠ ver a ressalva abaixo |

⚠⚠ **O CUSTO DO ÓRFÃO ESTÁ NA COLUNA DO MEIO.** Os dois de 25/08 foram tocados pela varredura de cor
daquele dia: consertei o contraste de componentes que ninguém renderiza. Órfão consome revisão,
varredura e leitura para sempre, sem nunca chegar a uma tela.

⚠⚠ **NENHUM FOI APAGADO, E ISSO É DELIBERADO.** A decisão já está escrita neste projeto a propósito
do `DefisNaoDevida.jsx`: *"não foi apagado — apagar componente é decisão à parte"*. E há precedente
concreto no mesmo diretório: o `PendenciasList` passou meses sem consumidor e foi **reconectado**
quando a aba Auditoria nasceu (`renderAuditoriaTab.jsx:13`). "Ninguém importa" não é "ninguém quer".

⚠ **A ressalva do `ReabrirCompetenciaModal`:** reabrir competência é ato com consequência fiscal, e a
Auditoria de notas registra por escrito que ela **lista** e *"não oferece 'Reabrir competência' nem
'Ignorar'"*. Se este modal era a porta daquilo, o sumiço pode ter sido a DECISÃO, não o descuido —
reconectá-lo por conta própria seria reabrir uma decisão.

### Os cinco handlers mortos são o mesmo evento

`useNotasFiscais` devolve `createProcuracao`, `revogarProcuracao`, `fecharCompetencia`,
`reabrirCompetencia` e `resolverPendencia` — **nenhum com chamador**. Não morreram um a um: os
painéis que os acionavam saíram da tela juntos, quando a aba enxugou.

⚠ **A cadeia abaixo deles está VIVA**: `reabrirCompetencia` chega a
`CompetenciaStateMachine.reabrirCompetencia` no backend, que exige `reason` e tem teste próprio. A
porta some da tela; o ato continua existindo. Por isso ficam anotados, não apagados.

## ⚠⚠ A ABA FLUXO DE CAIXA (`features/fluxo/`) — 27/08/2026

Grupo **Contabilidade**, logo depois da Conferência. `lib/leituraDoFluxo.js` (regra pura, 40 testes)
+ `pages/renderFluxoDeCaixaTab.jsx` (só ligação). O payload vem de
`GET /firm/companies/:id/fluxo-de-caixa`, e é **o MESMO que o portal do cliente lê** — o corpo é
compartilhado no servidor (`routes/fluxoDeCaixaHttp.js`).

- ⚠⚠ **VERDE NÃO APARECE AQUI, em nenhuma procedência.** Verde, nesta casa, quer dizer
  *pago/concluído* — o pior desfecho possível para uma linha que ainda não aconteceu. ⚠ **Nem o
  FATO é verde**: uma guia gerada e em aberto NÃO está paga. `TOKEN_PROIBIDO = "--state-ok"`, com
  teste varrendo `Object.values(PROCEDENCIA)`. Experimento: pondo `--state-ok` na PREVISAO, **2
  vermelhos**.
- ⚠⚠ **A palavra "previsto" vai no TEXTO**, não só na cor — impressão em preto e branco e daltonismo
  tiram a cor.
- ⚠⚠ **NÃO EXISTE `total`**, nem por mês nem no bloco recolhido: `totaisParaTela` e `totalDoBloco`
  devolvem `fato`/`previsao`/`desconhecido` separados, e há teste exigindo que a chave `total` não
  exista. Um número único de doze meses é o que alguém imprime e leva ao banco. ⚠ Sem saldo inicial
  não há saldo acumulado — a ausência é coerente, não uma falta.
- ⚠⚠ **`dinheiro(null)` é `"—"`, nunca `"R$ 0,00"`** — mas **zero DECLARADO continua sendo um
  valor**. É a família do `Number(null) === 0` que já custou um "0%" na tela do cliente.
- ⚠⚠ **O dia ausente não vira dia inventado**: a projeção diz *"no mês"* e o MOTIVO vem do servidor,
  com a frase pronta. A tela não escreve a sua — as duas divergiriam na primeira correção.
- ⚠ **A TELA ABRE COM 3 MESES** (`MESES_ABERTOS_POR_PADRAO`), os outros nove recolhidos com o total
  do bloco à vista. O contrato entrega os 12; a leitura começa onde a evidência está.
- ⚠ **A evidência de cada linha vai no TEXTO** — a faixa (*"entre R$ 120,00 e R$ 140,00"*), o `n` e
  o confronto declarado × observado. `title` não aparece no teclado nem no toque.
- ⚠⚠ **CADA RESSALVA TEM TÍTULO PRÓPRIO, e o título sai da REGRA.** Escrito no componente ele era o
  MESMO nas três caixas (*"Sobre este fluxo"*) — três avisos âmbar empilhados e indistinguíveis, que
  é exatamente o defeito que o `titulo` obrigatório do `Aviso` existe para impedir. **Achado no
  navegador, não no teste**; hoje há teste exigindo seis títulos distintos e nenhum vazio.
- ⚠ **O mock exercita todos os ramos, e a EMPRESA ZERADA tem um fluxo próprio** — `semImposto` e
  `recorrenciaIndisponivel` são mutuamente exclusivos, no fluxo cheio, com o imposto projetado e com
  as séries. Mock de uma forma só os deixaria inalcançáveis offline.

## ⚠ A TABELA DO ANEXO (apuracao-v2) — o que ela responde, e o que NÃO se recria

`features/apuracao-v2/components/TabelaAnexoReferencia.jsx` + a regra pura
`lib/anexoDaEmpresa.js`. Ela já entrega **anexo efetivo · faixa atual · RBT12 · alíquota efetiva ·
repartição por tributo · CPP fora do DAS no Anexo IV · ICMS/ISS fora do DAS na 6ª faixa · "quanto
falta para a próxima faixa"**.

⚠⚠ **UM PLANO DE 25/08/2026 PEDIU UMA TELA NOVA COM SETE DESSES SETE ITENS.** Ele foi escrito sem
ver este componente. Antes de construir painel fiscal novo, **abra este arquivo** — e lembre que
"Situação Fiscal", neste projeto, é a aba do **SITFIS** (débitos na Receita), outra coisa: uma tela
nova com esse nome colide com ela.

### ⚠⚠ "Faltam R$ X para a próxima faixa" — a FRASE é o produto, não o número

`distanciaAteAProximaFaixa`. "Faltam R$ 240.000" lido como *"posso faturar R$ 240.000 antes de subir
de faixa"* é **falso nos dois sentidos**: o RBT12 é soma **móvel** de 12 meses e anda `mês que entra
− mês que sai`. Pode virar faturando menos; pode não virar faturando mais. Daí o desenho:

- o texto nomeia o **RBT12**, nunca "faturamento", e a ressalva vai **no corpo** — `title` não
  aparece no teclado nem no toque;
- ⚠ **não há projeção, prazo nem "meses até virar"**, e há teste proibindo esses campos: dizer
  QUANDO exigiria a série dos 12 meses da janela, e projetar por média seria o portal chutando o mês
  da virada de alíquota;
- ⚠⚠ **cruzar para a 6ª faixa não é só alíquota maior** — é o sublimite (LC 123/2006, art. 13-A), e
  o ICMS/ISS **sai do DAS**. O aviso acende **só** nessa virada, e o tributo é DERIVADO da tabela
  (Anexo I → ICMS, Anexo III → ISS), nunca de lista escrita à mão;
- ⚠⚠ **na 6ª faixa não existe "próxima faixa"**: o que existe acima é a **saída do Simples**.
  Estado próprio, `falta` nulo, e a distância até o teto com nome próprio.

⚠ **Não devolva `Math.max(0, …)` na distância.** Já esteve lá e o experimento deu **zero
vermelhos**: `v <= f.ate` é condição do `find` de `faixaDoRbt12`, então a faixa devolvida sempre
contém o valor. Era cinto que não aperta; a invariante é que virou teste.

### ⚠⚠ O RBT12 DO MOCK VARIA POR EMPRESA — não "arredonde" um de volta

Era **480.000 fixo** nas seis empresas, ou seja sempre a 3ª faixa: os dois ramos mais caros eram
**inalcançáveis offline**. Hoje `RBT12_DO_MOCK` (`mockApi.js`) tem um valor por faixa exercitada
(480.000 · 3.000.000 · 4.000.000), escolhido **pela faixa**, não por realismo.

⚠ Terceira vez nesta mesma rodada que o mock escondeu um ramo: antes foram os **valores redondos**
(que escondiam o parser ×100) e o **faturamento zero em 6 de 6 empresas**.

## Blocos com CLAUDE.md próprio (Q17)

Ler antes de mexer; atualizar ao terminar: `src/features/companies/`,
`src/features/guides/`, `src/features/accounting/`.
- **Aba default da empresa = Anotações** (`useManageCompaniesWorkspace.deriveCompanyDetailTab`
  + `useManageAuthSession` → `/companies/:id/anotacoes`). Era Lançamentos até a Anotações virar
  grupo próprio — particularidade da empresa se lê ANTES de mexer em número.
- **Dashboard** filtra por competência (default mês anterior, `changeDashboardCompetencia`)
  e por pendências; tags por estado (verde/amarelo=vazio/vermelho); card inteiro muda de
  cor quando a empresa está **fechada** (contábil).

## Testes (Jest) — `import.meta.env` quebra em tempo de PARSE

O Jest roda em CommonJS: `import.meta` é erro de sintaxe, e o arquivo inteiro morre **antes do
primeiro teste**. Quem paga não é quem escreve — é quem **importa**. `src/api/client.js` derrubava
por transitividade qualquer suíte que chegasse nele (foi o que manteve
`circular/components/__tests__/renderCircularTab.test.jsx` sem rodar nenhuma vez, com o `npm test`
reportando "1 failed" como paisagem).

Resolvido na raiz: `babel.config.js` reescreve `import.meta.env` → `process.env` **só no env
`test`** (no build quem substitui é o Vite, e `process` não existe no browser). Ou seja: **importar
`createApiClient` num componente testado não exige mock nenhum** — não há regra para lembrar.

- Rodar: `npm test -w @contabilidade/web`. **0 suíte falhando** é o estado esperado.
- Regra de tela vive em `lib/` com teste próprio (ex.: `circular/lib/estadoGuia.js`); o teste de
  componente cobre a **ligação** (cor, chip, rodapé saindo da mesma leitura), não a regra de novo.

## Regras

- Toda feature nova precisa de entrada no `mockApi.js` antes de integrar o real
- Nunca chamar `fetch` ou `axios` diretamente em componentes — sempre via `src/api/`
- Manter `CompanyDetailPage` como página central de detalhes da empresa cliente
- Não introduzir dependências novas sem necessidade clara
- Testar o caminho feliz no browser antes de marcar como concluído
