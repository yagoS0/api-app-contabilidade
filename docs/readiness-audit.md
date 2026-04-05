# Readiness Audit Report

## Scope
- API auth and route permissions.
- Tenant isolation for `invoices`, `nfse`, and `adn` routes.
- Worker lock behavior under concurrent execution.
- Database readiness and migration pipeline gates.
- Deployment prerequisites for DigitalOcean.

## Findings Addressed
- Added tenant/legacy company access checks for:
  - `apps/api/src/routes/invoices.js`
  - `apps/api/src/routes/nfse.js`
  - `apps/api/src/routes/adn.js`
- Removed API key via query string fallback:
  - `apps/api/src/routes/middlewares/auth.js`
- Restricted API key fallback on sensitive endpoints:
  - `apps/api/src/routes/status.js`
- Added basic in-memory rate limiting to auth endpoints:
  - `apps/api/src/routes/auth.js`
- Replaced non-atomic lock acquisition with atomic DB update strategy:
  - `apps/api/src/application/guides/GuideLockService.js`
  - `apps/api/src/workers/guideEmailWorker.js`
  - `apps/api/src/application/guides/GuideScheduledEmailService.js`
- Added readiness endpoint with DB check:
  - `apps/api/src/routes/status.js` (`GET /readyz`)
- Added migration gates for runtime/deploy:
  - `apps/api/package.json` scripts
  - `Dockerfile` startup via `start:prod`
- Fixed pending email payload behavior:
  - `apps/api/src/workers/guideEmailWorker.js` now sends guide PDF as attachment (instead of link-only body)
  - `apps/api/src/application/guides/GuideStorageService.js` supports buffer download for attachment flow

## Residual Risks
- In-memory auth rate limiting is per process; multi-replica enforcement should move to Redis or edge/WAF.
- Existing migration history still needs manual DBA review before first production rollout.
- Some legacy endpoints may require deeper business-specific authorization rules depending on client model.

## Recommended Go/No-Go Gate
- No-go if `prisma:migrate:status` has pending/failing migrations.
- No-go if `/readyz` is not stable after deploy.
- No-go if cross-tenant test cases return data instead of `403`/`404`.

