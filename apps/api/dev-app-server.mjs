// Helper de DEV (não faz parte do server de produção).
// Sobe SÓ os routers usados pelo app mobile — /auth (login/refresh) e /client
// (empresas, notas, guias, dashboard) — num Express mínimo, SEM iniciar nenhum
// worker/cron. Serve para o BFF (portal-cliente-app) fazer login e ler dados reais
// em desenvolvimento, sem risco fiscal.
//
// Uso:
//   cd apps/api
//   node --openssl-legacy-provider dev-app-server.mjs   (porta 3000; DEV_APP_PORT p/ trocar)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './src/infrastructure/db/prisma.js';
import { UserRepository } from './src/infrastructure/db/UserRepository.js';
import { AuthService } from './src/application/auth/AuthService.js';
import { createEnsureAuthorized } from './src/routes/middlewares/auth.js';
import { createAuthRouter } from './src/routes/auth.js';
import { createClientPortalRouter } from './src/routes/client/index.js';

const log = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.warn('[warn]', ...a),
  error: (...a) => console.error('[error]', ...a),
};

// Sem api-key neste helper; o app usa JWT (login por e-mail/senha).
const API_KEYS = [];

const app = express();
app.use(express.json());
app.use(cors()); // libera o BFF/app em dev

const ensureAuthorized = createEnsureAuthorized({ AuthService, API_KEYS, log });
app.locals.ensureAuthorized = ensureAuthorized;

app.use('/auth', createAuthRouter({ AuthService, UserRepository, log, ensureAuthorized }));
app.use('/client', createClientPortalRouter({ ensureAuthorized, log }));

const PORT = Number(process.env.DEV_APP_PORT || 3000);
const server = app.listen(PORT, () =>
  console.log(`[dev-app] /auth + /client em http://localhost:${PORT} (SEM workers)`),
);

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
