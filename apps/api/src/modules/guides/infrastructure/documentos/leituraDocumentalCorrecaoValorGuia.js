import { getGuidePdfBuffer } from "../../../../application/guides/GuideService.js";
import { lerLinhaDigitavelDoPdf } from "../../../../application/guides/lerLinhaDigitavelDoPdf.js";

export function criarLeituraDocumentalCorrecaoValorGuia({ carregarPdf = getGuidePdfBuffer, ler = lerLinhaDigitavelDoPdf } = {}) {
  return async (guia, novoValor) => {
    const pdf = await carregarPdf(guia);
    return ler(pdf, { valorTotal: novoValor, vencimento: guia.vencimento });
  };
}
