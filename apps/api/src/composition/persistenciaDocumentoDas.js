import { persistirDocumentoDas } from "../modules/fiscal/public.js";
import { lerGuiaPorSourceFileId } from "../modules/guides/infrastructure/prisma/adaptadorGuidesPrisma.js";
import { createOrUpdateGuideFromProcessing, hashPdf } from "../modules/guides/infrastructure/legacy/adaptadorGuiaService.js";

export function persistirDocumentoDasComGuias(input) {
  return persistirDocumentoDas(input, {
    lerGuiaPorSourceFileId,
    createOrUpdateGuideFromProcessing,
    hashPdf,
    clock: () => new Date(),
  });
}
