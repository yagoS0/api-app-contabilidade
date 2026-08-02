# CLAUDE.md — Empresas (apps/web/src/features/companies)

Feature da carteira de empresas: dashboard (lista), detalhe (abas), formulário, certificado.

## Subpastas

- `list/` — **Dashboard** (`pages/renderCompaniesHomePage.jsx`, `components/renderCompanyCard.jsx`).
- `detail/` — página de detalhe da empresa com abas (`pages/renderCompanyDetailPage.jsx`,
  `components/renderCompanyDetailHeader.jsx`). **Aba default = Lançamentos (Q17)**.
- `form/`, `certificate/`.

## Dashboard — quatro visões

`modoVisao` em `renderCompaniesHomePage`: **Cards · Ano · Calendário · Obrigações**. As duas
últimas não são "listas de empresa" — são o mesmo recorte da carteira por outro eixo. **Obrigações**
(`features/obrigacoes/components/renderObrigacoesPage.jsx`) responde "o que EU preciso entregar",
enquanto o calendário mostra o mesmo no formato de grade. Obrigação **não é guia**: guia é o que o
cliente paga, obrigação é o serviço do contador — por isso a tela não fala em valor nem pagamento.
Obrigação com `conclusaoAutomatica` **não mostra botão de concluir**: o backend recusaria o clique.
Dentro de Obrigações, o botão **Regras do escritório** (`renderRegrasObrigacao.jsx`) aplica uma
obrigação a várias empresas — é o que substitui o catálogo pré-carregado.

### Calendário (`features/calendario/components/renderCalendarioGrid.jsx`)

Quatro visões: **Mês · Semana · Dia · Agenda**, com atalhos `M S D A` e `T` (hoje) — ignorados
quando o foco está num campo. **Agenda é o default em tela estreita**: a grade de mês vira 42
células ilegíveis num celular. `ehTelaEstreita()` trata largura 0 como *desconhecida*, não como
estreita — sem isso a tela abre em modo celular num container ainda sem layout e fica assim, porque
`visao`/`sidebarAberta` são valores iniciais e não se recalculam.

Sidebar com mini-calendário (pontinho no dia que tem evento) e filtro por categoria — o filtro age
na **exibição**, não na busca. Em tela estreita ela vira **drawer**: largura total e a grade some
enquanto está aberta.

**Guia e obrigação têm cores e símbolos distintos** (`•` laranja × `▸` verde) porque respondem a
perguntas diferentes; obrigação **vencida** ganha contorno vermelho por cima da cor da categoria.
`fmtMoney` só aparece em guia — obrigação não tem valor.

## Dashboard — reorganização (Lote C)

- **Duas visões** (`modoVisao` em `renderCompaniesHomePage`): **Cards** (uma competência) e
  **Ano** (`components/renderAnnualGrid.jsx` → `GET /firm/companies/annual?ano=`). Na grade anual
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

Ordem/roteamento: `useManageCompaniesWorkspace.deriveCompanyDetailTab` (default `lancamentos`)
+ `HEADER_TABS` (Lançamentos primeiro). Navegação ao abrir empresa:
`useManageAuthSession` → `/companies/:id/lancamentos`.

## Padrões

- Componentes recebem dados/handlers por props; estado de workspace em
  `app/hooks/useManageCompaniesWorkspace.js` (expõe `dashboardCompetencia` +
  `changeDashboardCompetencia`).
- Toda chamada nova precisa de par mock/real em `src/api/`.
