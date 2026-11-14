import { contabilizarDasCapturado } from "../modules/accounting/public.js";
import { lerCircularDasCapturado, gravarCircularDasCapturado, gravarAcrescimosDasCapturado } from "../modules/fiscal/infrastructure/prisma/circularDasCapturado.js";
import { gerarLancamentosDasCapturado } from "../modules/accounting/infrastructure/legacy/contabilidadeDasCapturado.js";
import { lerComposicaoDas } from "../modules/fiscal/infrastructure/documentos/lerComposicaoDas.js";

export function contabilizarDasCapturadoComLegado(input) {
  return contabilizarDasCapturado(input, {
    lerCircularDasCapturado,
    gravarCircularDasCapturado,
    lerComposicaoDas,
    gravarAcrescimosDasCapturado,
    gerarLancamentosDasCapturado,
  });
}
