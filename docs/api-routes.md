# Rotas da API (atualizado)

Legenda rápida:
- Header padrão: `Authorization: Bearer <token>` (JWT). API key só quando indicado.
- `201` criação, `200` sucesso, `202` processamento assíncrono.
- Erros comuns: `400` payload inválido, `401` auth ausente/inválida, `403` proibido, `404` não encontrado, `409` conflito, `500` erro interno.

## Autenticação de usuários (/auth)
- `POST /auth/signup`  
  Body: `{ name?, email, password>=8 }`  
  Resposta: `201 { status: "pending", message }`  
  Erros: `400 email_password_required | email_invalid | weak_password`, `409 user_exists | user_pending`.

- `POST /auth/login`  
  Body: `{ email | username | identifier, password }`  
  Resposta: `200 { token, refreshToken?, user, expiresInMs }`  
  Erros: `400 username_password_required`, `401 invalid_credentials`, `403 user_not_active`, `503 auth_not_configured`.

- `GET /auth/me`  
  Header: Bearer  
  Resposta: `200 { user }`; erro: `401 invalid_token`.

## Autenticação de clientes (/clients/login)
- `POST /clients/login`  
  Body: `{ email | login, password }` (login = email)  
  Resposta: `200 { token, client: { id, login, email, name }, expiresInMs }`  
  Erros: `400 login_password_required`, `401 invalid_credentials`, `503 auth_not_configured`.

## Administração de usuários (/admin) — role=admin
- `GET /admin/users?status=pending|active|rejected` → `200 { items }`
- `PATCH /admin/users/:id/approve` Body opcional `{ role: "user"|"admin" }`
- `PATCH /admin/users/:id/reject`
- `DELETE /admin/users/:id`
Erros: `400 invalid_status|invalid_role`, `401/403` se não for admin, `404 not_found`.

## Clientes (/clients)
- `POST /clients`  
  Header: Bearer (ou `x-api-key` se habilitado)  
  Body (resumo):  
  ```json
  {
    "client": { "name", "email", "password", "phone"?, "cpf"?, "login" opcional (usa email) },
    "company": {
      "razaoSocial", "cnpj", "nomeFantasia"?, "atividades"?, "porte"?, "tipoTributario"?,
      "endereco"?, "email"?, "telefone"?, "capitalSocial"?, "dataAbertura"?, "quantidadeSocios"?,
      "partners"?, "inscricaoMunicipal", "codigoServicoNacional", "codigoServicoMunicipal",
      "rpsSerie", "rpsNumero"?, "optanteSimples"?, "regimeEspecialTributacao"?
    }
  }
  ```  
  Resposta: `201 { ... }`  
  Erros: `400 <campo>_obrigatorio | cliente.senha_fraca`, `409 client_login_or_email_exists`, `500 internal_error`.

- `GET /clients?limit&offset` → `200 { items, total }`
- `GET /clients/:id` → `200 { ... }` ou `404 not_found`
- `DELETE /clients/:id` → `200 { status: "deleted" }` ou `404 not_found`

## Notas fiscais de produto (/invoices)
- `POST /invoices/import`  
  Header: Bearer (sem API key)  
  Body: `{ companyId, clientId?, xml, fileKey?, fileUrl?, fileType? }`  
  Resposta: `201 { invoice }`; Erros: `400 company_id_required | xml_required`, `409 invoice_exists`.

- `GET /invoices`  
  Query: `companyId` obrig., `clientId?`, `from?`, `to?`, `emitente?`, `chave?`, `limit?`, `offset?`  
  Resposta: `200 { items, total, limit, offset }`; Erro: `400 company_id_required`.

- `GET /invoices/:id` → `200 { invoice }` ou `404 not_found`

## NFS-e (serviços) (/nfse)
- `POST /nfse/issue`  
  Header: Bearer  
  Body (resumo): `{ companyId, tomador: { cnpjCpf, nome, email? }, servico: { descricao, valorServicos, issRetido?, aliquota? }, competencia?, referencia? }`  
  Resposta: `201 { status: "issued", ... }` ou `202 { status: "pending", ... }`;  
  Erros: `400 company_missing_fields | tomador_documento_invalido | servico_valor_invalido`, `404 company_not_found`.

## Execução e status
- `POST /run` (envio) — Bearer ou `x-api-key`; `202 { status: "started" }`, erro `409 already_running`.
- `GET /status` — Bearer ou `x-api-key`; `200 { running, lastRunStartedAt, lastRunFinishedAt, lastRunError, cron, messages, lastRunKind, lastRunStore }`.
- `GET /healthz` — público; `200 ok`.

## Autorização / Headers
- Preferencial: `Authorization: Bearer <token>` (JWT de `/auth/login` ou `/clients/login`).
- Fallback: `x-api-key` somente onde indicado (run/status/clients list se habilitado).

## Notas
- Configure `.env`: `DATABASE_URL`, `JWT_SECRET`, `API_KEYS` (opcional), `NFSE_CERT_PFX_PATH`, `NFSE_CERT_PFX_PASSWORD`, `NFSE_BASE_URL`, `NFSE_PATH` (default `/nfse/v1/rps`), etc.
- A rota de clientes cria login = email (lowercase) e exige senha ≥ 8.
