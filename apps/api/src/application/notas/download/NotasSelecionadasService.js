import { gerarDanfeNfe, resolverNotasDocumentais, prepararDocumentoNota } from "./DocumentoNotaService.js";
export { gerarDanfeNfe } from "./DocumentoNotaService.js";
import archiver from "archiver";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { gerarDanfseDaNota } from "../../nfse/danfse/danfseDaNotaDoPortal.js";

export const MAX_NOTAS_SELECIONADAS = 100;
const MAX_BYTES = 50 * 1024 * 1024;
const falha = (message, status = 400) => Object.assign(new Error(message), { status });

export async function baixarNotasSelecionadas({ portalClientId, notaIds, formato, client = prisma, gerarNfe = gerarDanfeNfe, gerarNfse = gerarDanfseDaNota }) {
  if (!Array.isArray(notaIds) || !notaIds.length || notaIds.length > MAX_NOTAS_SELECIONADAS
    || notaIds.some(id => typeof id !== "string" || !id.trim() || id.length > 100)) {
    throw falha(`Selecione de 1 a ${MAX_NOTAS_SELECIONADAS} notas.`);
  }
  if (!["XML", "PDF"].includes(formato)) throw falha("Escolha XML ou PDF.");
  const ids = [...new Set(notaIds)];
  const { byId, portal } = await resolverNotasDocumentais({ portalClientId, ids, client });
  const arquivos = [], falhas = [];
  let bytes = 0;
  for (const id of ids) {
    const n = byId.get(id);
    try {
      const { conteudo, nome } = await prepararDocumentoNota({ portalClientId, nota: n, portal, formato, client, gerarNfe, gerarNfse });
      bytes += conteudo.length;
      if (bytes > MAX_BYTES) throw falha("O lote excede 50 MB. Selecione menos notas.", 413);
      arquivos.push({ nome, conteudo });
    } catch (e) {
      if (e.status === 413) throw e;
      falhas.push({ nota: n.numero || id, motivo: e.message || "Não foi possível gerar o arquivo." });
    }
  }
  if (!arquivos.length) throw Object.assign(falha("Nenhum arquivo disponível. " + falhas.map(f => `Nota ${f.nota}: ${f.motivo}`).join("; "), 422), { falhas });
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  const pronto = new Promise((resolve, reject) => { archive.on("data", c => chunks.push(c)); archive.on("error", reject); archive.on("end", () => resolve(Buffer.concat(chunks))); });
  for (const f of arquivos) archive.append(f.conteudo, { name: f.nome });
  archive.append(`Notas selecionadas: ${ids.length}\nArquivos: ${arquivos.length}\nIndisponíveis: ${falhas.length}\n\n${falhas.map(f => `Nota ${f.nota}: ${f.motivo}`).join("\n")}\n`, { name: "RELATORIO.txt" });
  await archive.finalize();
  return { zip: await pronto, geradas: arquivos.length, falhas: falhas.length };
}
