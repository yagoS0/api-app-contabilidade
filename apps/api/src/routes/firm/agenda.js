import { Router } from 'express';
import { createTarefasUnificadasRouter } from './tarefasUnificadas.js';
import { calendarioLegadoRemovido } from './calendarioLegadoRemovido.js';

export function createAgendaRouter({ log } = {}) {
  const router = Router();
  router.use(createTarefasUnificadasRouter({ log }));
  router.use('/agenda', calendarioLegadoRemovido);
  return router;
}
