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

### Estado

- Preferir estado local (`useState`) para UI efêmera
- Estado compartilhado entre rotas: Context API ou prop drilling consciente
- Não adicionar Redux ou Zustand sem discutir antes

### Roteamento

- React Router (configurado em `App.jsx`)
- Rotas de firma e cliente separadas por prefixo `/firm/` e `/client/`
- Proteção de rota via componente wrapper de autenticação

### Estilo

- TailwindCSS — classes utilitárias diretamente nos componentes
- Não criar arquivos CSS por componente
- Componentes de UI reutilizáveis ficam em `src/components/`

## Regras

- Toda feature nova precisa de entrada no `mockApi.js` antes de integrar o real
- Nunca chamar `fetch` ou `axios` diretamente em componentes — sempre via `src/api/`
- Manter `CompanyDetailPage` como página central de detalhes da empresa cliente
- Não introduzir dependências novas sem necessidade clara
- Testar o caminho feliz no browser antes de marcar como concluído
