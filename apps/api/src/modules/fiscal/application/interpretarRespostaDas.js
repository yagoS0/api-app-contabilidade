import { buildPgdasGuidePayload, extractDasValueFromText } from "../domain/interpretacaoDas.js";

// A competência já foi validada pelo chamador. Interpretar não consulta o provedor,
// não escolhe serviço e não confirma pagamento, transmissão ou persistência.
export async function interpretarRespostaDas({ response, contribuinteCnpj, competencia }, { lerTextoPdfDas }) {
  const mapped = buildPgdasGuidePayload({ response, contribuinteCnpj, competencia });
  // GERARDAS12 pode devolver somente PDF. A leitura é best-effort, como no legado.
  if (mapped.parsed.valor == null || mapped.parsed.valor === 0) {
    try {
      const valorFromPdf = extractDasValueFromText(await lerTextoPdfDas(mapped.pdfBuffer));
      if (valorFromPdf != null && valorFromPdf > 0) {
        mapped.parsed.valor = valorFromPdf;
      }
    } catch {
      // Falha de leitura conserva o valor original (inclusive null ou zero).
    }
  }
  return mapped;
}
