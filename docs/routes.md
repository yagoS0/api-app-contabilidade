# Rotas da API

## Autenticação (`/auth`)
- `POST /auth/signup`  
  Body: `{ "name"?: string, "email": string, "password": string (>=8) }`  
  Respostas: `201 { status: "pending", message }`; erros: `400 email_password_required | email_invalid | weak_password`, `409 user_exists | user_pending`.

- `POST /auth/login`  
  Body: `{ "email" | "username" | "identifier": string, "password": string }`  
  Respostas: `200 { token, user, expiresInMs }`; erros: `400 username_password_required`, `401 invalid_credentials`, `403 user_not_active`, `503 auth_not_configured`.

- `GET /auth/me`  
  Header: `Authorization: Bearer <token>`  
  Respostas: `200 { user }`; erros: `401 invalid_token`.

## Administração de usuários (`/admin`)
- `GET /admin/users?status=pending|active|rejected`  
  Header: `Authorization: Bearer <token-admin>`  
  Respostas: `200 { items: User[] }`; erros: `400 invalid_status`, `401/403` se não for admin.

- `PATCH /admin/users/:id/approve`  
  Header: `Authorization: Bearer <token-admin>`  
  Body opcional: `{ "role": "user" | "admin" }`  
  Respostas: `200 { user }`; erros: `400 invalid_role`, `404 not_found`.

- `PATCH /admin/users/:id/reject`  
  Header: `Authorization: Bearer <token-admin>`  
  Respostas: `200 { user }`; erros: `404 not_found`.

- `DELETE /admin/users/:id`  
  Header: `Authorization: Bearer <token-admin>`  
  Respostas: `200 { user }`; erros: `404 not_found`.

## Clientes (`/clients`)
- `POST /clients`  
  Header: `Authorization: Bearer <token>` ou `x-api-key` (se habilitado)  
  Body (resumo): `{ client: {name,email,phone?,cpf?}, company: {razaoSocial,cnpj,..., partners?} }`  
  Respostas: `201 { ... }`; erros: `400 <campo>_obrigatorio`, `500 internal_error`.

- `GET /clients?limit=&offset=`  
  Header: `Authorization: Bearer <token>` ou `x-api-key`  
  Respostas: `200 { items, total }`.

- `GET /clients/:id`  
  Header: `Authorization: Bearer <token>` ou `x-api-key`  
  Respostas: `200 { ... }`; erros: `404 not_found`.

## Execução de envio (`/run`)
- `POST /run`  
  Header: `Authorization: Bearer <token>` ou `x-api-key`  
  Respostas: `202 { status: "started" }`; erros: `409 already_running`.

## Status e saúde
- `GET /status`  
  Header: `Authorization: Bearer <token>` ou `x-api-key`  
  Respostas: `200 { running, lastRunStartedAt, lastRunFinishedAt, lastRunError, cron, messages, lastRunKind, lastRunStore }`.

- `GET /healthz`  
  Resposta: `200 ok`.

## Autorização
- Preferencial: `Authorization: Bearer <token>` (JWT de `/auth/login`).
- Fallback opcional: `x-api-key` (se `API_KEYS` configurado).

## Observações
- Para login/usuarios, é necessário o modelo `User` migrado e um admin criado (use `npm run prisma:seed` com `ADMIN_EMAIL/ADMIN_PASSWORD`).
- Defina `DATABASE_URL` e `JWT_SECRET` no `.env`.  
- JWT desabilitado se `JWT_SECRET` vazio ou `AuthService` não configurado; nesse caso apenas API key (se habilitado) autoriza.

