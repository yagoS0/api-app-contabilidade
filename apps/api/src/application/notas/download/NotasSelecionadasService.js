import archiver from "archiver";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { gerarPDF } from "nfe-danfe-pdf";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { lerEnvelopeXml, raizDoXml } from "../../nfse/lerEnvelopeXml.js";
import { gerarDanfseDaNota } from "../../nfse/danfse/danfseDaNotaDoPortal.js";
import { safeFilePart } from "../../nfse/danfse/loteDanfseDoPortal.js";

export const MAX_NOTAS_SELECIONADAS = 100;
const MAX_BYTES = 50 * 1024 * 1024;
const falha = (message, status = 400) => Object.assign(new Error(message), { status });

export async function gerarDanfeNfe({ xml, cancelada = false }) {
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw falha("XML de NF-e inválido.");
  const obj = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true }).parse(xml);
  const proc = obj.nfeProc;
  const inf = proc?.NFe?.infNFe;
  if (!inf || String(inf.ide?.mod) !== "55" || !proc.protNFe?.infProt?.nProt) {
    throw falha("DANFE requer o XML completo da NF-e com protocolo de autorização. O resumo não contém esses dados.");
  }
  if (!["100", "150"].includes(String(proc.protNFe.infProt.cStat))) throw falha("O XML não comprova autorização da NF-e.");
  const doc = await gerarPDF(xml, { cancelada, textoRodape: "Altan" });
  // A biblioteca encerra o documento; apenas consumimos o stream.
  const chunks = [];
  for await (const chunk of doc) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function baixarNotasSelecionadas({ portalClientId, notaIds, formato, client = prisma, gerarNfe = gerarDanfeNfe, gerarNfse = gerarDanfseDaNota }) {
  if (!Array.isArray(notaIds) || !notaIds.length || notaIds.length > MAX_NOTAS_SELECIONADAS
    || notaIds.some(id => typeof id !== "string" || !id.trim() || id.length > 100)) {
    throw falha(`Selecione de 1 a ${MAX_NOTAS_SELECIONADAS} notas.`);
  }
  if (!["XML", "PDF"].includes(formato)) throw falha("Escolha XML ou PDF.");
  const ids = [...new Set(notaIds)];
  const notas = await client.portalInvoice.findMany({
    where: { clientId: portalClientId, id: { in: ids } },
    select: { id: true, type: true, numero: true, xmlRaw: true, status: true, statusEfetivo: true },
  });
  const byId = new Map(notas.map(n => [n.id, n]));
  const faltantes = ids.filter(id => !byId.has(id));
  if (faltantes.length) {
    const portal = await client.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
    const emitidas = portal?.companyId ? await client.serviceInvoice.findMany({
      where: { companyId: portal.companyId, id: { in: faltantes } },
      select: { id: true, numeroNfse: true, xml: true, status: true },
    }) : [];
    for (const n of emitidas) byId.set(n.id, { ...n, type: "NFSE", numero: n.numeroNfse, xmlRaw: lerEnvelopeXml(n.xml).xml });
  }
  // IDs fora da empresa e IDs inexistentes produzem exatamente a mesma resposta.
  if (ids.some(id => !byId.has(id))) throw falha("Uma ou mais notas não foram encontradas nesta empresa. Atualize a lista.", 404);
  const arquivos = [], falhas = [];
  let bytes = 0;
  for (const id of ids) {
    const n = byId.get(id);
    try {
      const xml = n.xmlRaw;
      const raiz = raizDoXml(xml);
      if (!xml || !["NFSe", "NFe", "nfeProc"].includes(raiz)) throw falha("XML completo indisponível; o resumo da captura não substitui o documento.");
      const conteudo = formato === "XML" ? Buffer.from(xml, "utf8") : n.type === "NFE"
        ? await gerarNfe({ xml, cancelada: ["cancelada", "cancelled"].includes(String(n.statusEfetivo || n.status).toLowerCase()) })
        : (await gerarNfse({ portalClientId, notaId: id, client })).pdf;
      bytes += conteudo.length;
      if (bytes > MAX_BYTES) throw falha("O lote excede 50 MB. Selecione menos notas.", 413);
      arquivos.push({ nome: `${safeFilePart(n.type)}-${safeFilePart(n.numero) || "sem-numero"}-${safeFilePart(id)}.${formato.toLowerCase()}`, conteudo });
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
