import { parseArrecadacaoComposicao } from "../../../../application/fiscal/serpro/parseArrecadacao.js";

export async function lerComposicaoDas(pdfBuffer) {
  const pdfParse = (await import("pdf-parse")).default;
  const txt = String((await pdfParse(pdfBuffer))?.text || "");
  return parseArrecadacaoComposicao(txt);
}
