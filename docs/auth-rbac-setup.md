# Guia rápido: User + RBAC + JWT + API key

 ok ## 1) Modelo User no Prisma
- Garanta no `prisma/schema.prisma` o modelo `User` com:
  - `email` único
  - `passwordHash`
  - `role`: `user | admin`
  - `status`: `pending | active | rejected`
- Migração: `npx prisma migrate dev --name add-users`
- Seed do admin: defina `ADMIN_EMAIL/ADMIN_PASSWORD` no `.env` e rode `npm run prisma:seed`.

 ok ## 2) RBAC simples
- Use o middleware `ensureAuthorized` para validar JWT.
- Em rotas de admin, exigir `{ requireRole: "admin" }`.
- Para colaboradores/clientes, verificar `status === "active"`.
- Futuro: escopo de dados filtrando por usuário logado (ex.: user-company).

## 3) JWT (refresh opcional)
- `.env`: `JWT_SECRET` e opcional `JWT_EXPIRES_IN` (ex.: `1h`).
- `/auth/login`: emite JWT (já implementado).
- Refresh opcional: endpoint `/auth/refresh` com token de refresh persistido (httpOnly cookie). Se não precisar agora, mantenha só access token curto.

## 4) API key apenas para integrações
- `.env`: `API_KEYS` (lista separada por vírgula).
- Middleware: permitir fallback de API key só em rotas de integração (ex.: `/run`, `/status`, integrações internas).
- Rotas sensíveis (`/admin/users`, `/auth/*`, `/clients`) devem exigir JWT e não aceitar API key.

## 5) Configuração mínima do `.env`
```
DATABASE_URL=postgresql://...
JWT_SECRET=uma_senha_forte
JWT_EXPIRES_IN=1h        # opcional
API_KEYS=minha-chave-interna   # opcional, só integrações
ADMIN_EMAIL=admin@empresa.com
ADMIN_PASSWORD=trocar123
```

## 6) Rotas a validar
- `/auth/signup` (gera usuário `pending`)
- `/auth/login` (gera JWT)
- `/auth/me` (valida token)
- `/admin/users` (role=admin)

