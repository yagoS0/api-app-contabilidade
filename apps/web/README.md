# @contabilidade/web

Front-end do monorepo usando Vite + React.

## Modos de API

- `mock`: usa dados simulados com `@faker-js/faker`, sem depender do backend.
- `real`: usa login real (`/auth/login`) e rotas firm.
- `real_with_mock_fallback` (recomendado no dev): tenta API real e cai para mock em falhas.

## Variaveis

Copie `.env.example` para `.env`:

- `VITE_API_MODE=mock|real|real_with_mock_fallback`
- `VITE_API_BASE_URL=http://localhost:3000`
- `VITE_API_TOKEN=...` (opcional; usado como fallback, o login do portal salva token em localStorage)

## Scripts

- `npm run dev -w @contabilidade/web`
- `npm run build -w @contabilidade/web`

## Telas implementadas

- Login (`JWT`) com sessao persistida.
- Home de empresas em cards com botao `Acessar`.
- Cadastro de empresa via `POST /firm/companies`.
- Detalhe da empresa com guias + botao de reenvio por guia.
- Botao de ligar/desligar job via `GET/PATCH /firm/guides/settings`.
