import { executarBackfillDeProvisoes } from '../modules/accounting/application/backfillProvisionsFromExistingGuides.js';
import { criarPortasBackfill } from '../modules/accounting/infrastructure/prisma/backfillProvisionsFromExistingGuides.js';

export function backfillProvisionsFromExistingGuides(entrada = {}, db) {
  return executarBackfillDeProvisoes(entrada, criarPortasBackfill(db));
}
