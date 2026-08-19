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

⚠ **Verde é CONCLUÍDO — nunca use verde em botão de ação primária.** Um botão verde de "faça isto"
ensina o contrário exatamente nas telas onde o verde precisa ser lido como "está fechado" (o rodapé
`D = C ✓ ok`, a guia paga, a obrigação entregue). Ação primária é o **accent**. Pelo mesmo motivo,
âmbar é "pendência", não decoração: um menu permanentemente âmbar (era o caso do SERPRO) treina o
olho a ignorar a cor que significa "falta enviar".

⚠ **Impressão é uma regra só, compartilhada:** bloco `@media print` no `App.css`, ligado por
`body.imprimindo` + `data-print-area` (mais `data-print-only` e `data-print-tabela`). Todo
`!important` ali é proposital — é a única alavanca da cascata contra os ~2.200 `style={{}}` inline.
Tela nova que precise imprimir **reusa**, não copia.

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
