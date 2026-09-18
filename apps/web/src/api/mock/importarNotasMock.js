import { importarNotasEmLotes } from "../real/importarNotasEmLotes";

// Exercita o mesmo progresso e agregação do ambiente conectado, sem persistência.
export async function importarNotasMock(companyId, files, { type = "NFSE", onProgress, shouldContinue } = {}) {
  const vistos = new Set();
  return importarNotasEmLotes(async (_url, { body }) => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    const lote = { ok: true, mock: true, importadas: 0, duplicadas: 0, recusadas: 0, emitidas: 0, recebidas: 0, created: 0, updated: 0, duplicates: 0, errors: [], detalhes: [] };
    for (const file of body.getAll("files")) {
      let motivo = /\.zip$/i.test(file.name) ? "mock_zip_nao_processado" : null;
      let xml;
      if (!motivo) {
        xml = await file.text();
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        const raiz = doc.documentElement?.localName?.toLowerCase();
        const nfe = ["nfeproc", "procnfe", "nfe", "resnfe"].includes(raiz);
        motivo = doc.querySelector("parsererror") ? "invalid_xml" : type === "NFE" && !nfe ? "outro_documento" : type !== "NFE" && nfe ? "nfe_na_area_nfse" : null;
      }
      if (motivo) {
        lote.recusadas++;
        lote.errors.push({ file: file.name, reason: motivo });
        lote.detalhes.push({ arquivo: file.name, resultado: "recusada", motivo });
      } else if (vistos.has(xml)) {
        lote.duplicadas++; lote.duplicates++;
      } else {
        vistos.add(xml); lote.importadas++; lote.created++;
      }
    }
    return lote;
  }, companyId, files, type, onProgress, shouldContinue);
}
