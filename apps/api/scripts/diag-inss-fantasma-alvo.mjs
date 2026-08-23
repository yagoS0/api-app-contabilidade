// SOMENTE LEITURA. Não escreve nada, não chama SERPRO, não apaga nada.
//
// RECONFIRMAÇÃO DO ALVO, do zero, pelo CONTEÚDO DO PDF (não pela lista de ninguém):
// quais guias `tipo:"INSS"` não têm NENHUMA contribuição previdenciária na composição impressa.
//
// Diferenças de propósito para `diag-inss-fantasma-consequencias.mjs`:
//   1. varre INSS de QUALQUER `status` e QUALQUER `source` (aquele filtrava PROCESSED+SERPRO);
//   2. classifica cada achado em TEM_SUBSTITUTA × ORFA, e mostra a evidência;
//   3. lista TODA guia da mesma empresa+competência (qualquer tipo) — é assim que se descobre
//      de onde nasceu a terceira linha (`tipo:"PIS"` de 645,15 em 2026-05);
//   4. mede o que uma exclusão arrastaria (cascade real do schema + relações SetNull).
//
//   node apps/api/scripts/diag-inss-fantasma-alvo.mjs

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseArrecadacaoComposicao, tributosSeNaoForPrevidenciario } from "../src/application/fiscal/serpro/parseArrecadacao.js";

const money = (v) => (v == null ? "—" : Number(v).toFixed(2));
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const ts = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—");

function pdfDoRawPayload(extracted) {
  const raw = extracted && extracted.rawPayload;
  if (!raw) return null;
  let dados = raw.dados ?? raw.Dados;
  if (typeof dados === "string") { try { dados = JSON.parse(dados); } catch { return null; } }
  const itens = Array.isArray(dados) ? dados : dados ? [dados] : [];
  for (const item of itens) {
    const b64 = item && (item.pdf || item.docArrecadacaoPdfB64 || item.pdfBase64);
    if (typeof b64 === "string" && b64.length > 100) {
      try { return Buffer.from(b64, "base64"); } catch { return null; }
    }
  }
  return null;
}

async function main() {
  const pdfParse = (await import("pdf-parse")).default;

  // ---------- 1. UNIVERSO AMPLO: toda guia tipo INSS, qualquer status, qualquer source ----------
  const todasInss = await prisma.guide.findMany({
    where: { tipo: "INSS" },
    select: {
      id: true, portalClientId: true, competencia: true, valor: true, vencimento: true,
      status: true, source: true, sourceFileId: true, hash: true, extracted: true,
      pdfBytes: true, paymentStatus: true, emailStatus: true, emailSentAt: true,
      liberadaCliente: true, parcelamentoId: true, createdAt: true, updatedAt: true,
    },
    orderBy: [{ competencia: "asc" }],
  });

  console.log(`Guias tipo="INSS" no banco (qualquer status/source): ${todasInss.length}`);
  const porStatus = {};
  for (const g of todasInss) porStatus[`${g.status}/${g.source}`] = (porStatus[`${g.status}/${g.source}`] || 0) + 1;
  console.log(`  por status/source: ${JSON.stringify(porStatus)}`);

  const alvo = [];
  let semPdf = 0;
  let previdenciarias = 0;
  for (const g of todasInss) {
    const buf = g.pdfBytes ? Buffer.from(g.pdfBytes) : pdfDoRawPayload(g.extracted);
    if (!buf || !buf.length) { semPdf += 1; continue; }
    let texto = "";
    try { texto = String((await pdfParse(buf))?.text || ""); } catch { semPdf += 1; continue; }
    const comp = parseArrecadacaoComposicao(texto);
    const trib = tributosSeNaoForPrevidenciario(comp.itens);
    if (trib) alvo.push({ g, tributos: trib, itens: comp.itens, totais: comp.totais });
    else previdenciarias += 1;
  }
  console.log(`  sem PDF legível: ${semPdf}  |  previdenciárias de verdade (mantidas): ${previdenciarias}`);
  console.log(`\n>>> ALVO RECONFIRMADO PELO PDF: ${alvo.length} guia(s) <<<`);
  if (alvo.length !== 6) console.log(`\n⚠⚠ ATENÇÃO: o alvo NÃO é 6. Era 6 no diagnóstico de 21/08/2026. PARAR e reavaliar.\n`);

  const pIds = [...new Set(alvo.map((a) => a.g.portalClientId).filter(Boolean))];
  const portais = await prisma.portalClient.findMany({
    where: { id: { in: pIds } },
    select: { id: true, razao: true, cnpj: true, hasProlabore: true, companyId: true },
  });
  const pMap = new Map(portais.map((p) => [p.id, p]));

  // ---------- 2. TODAS as guias das mesmas empresas+competências, QUALQUER tipo ----------
  const comps = [...new Set(alvo.map((a) => a.g.competencia))];
  const vizinhas = await prisma.guide.findMany({
    where: { portalClientId: { in: pIds }, competencia: { in: comps } },
    select: {
      id: true, portalClientId: true, competencia: true, tipo: true, valor: true, valorOriginal: true,
      vencimento: true, status: true, source: true, sourceFileId: true, extracted: true,
      pdfBytes: true, emailStatus: true, paymentStatus: true, createdAt: true, updatedAt: true,
      vazioEm: true, vazioPor: true, vazioMotivo: true, reviewedByUserId: true, reviewedAt: true,
    },
    orderBy: [{ competencia: "asc" }, { createdAt: "asc" }],
  });

  // ---------- 3. O que a exclusão arrastaria ----------
  const ids = alvo.map((a) => a.g.id);
  const entries = await prisma.accountingEntry.findMany({
    where: { sourceGuideId: { in: ids } },
    select: { id: true, sourceGuideId: true, tipo: true, subtipo: true, eventType: true, competencia: true },
  });
  const envios = await prisma.envioGuia.findMany({
    where: { guideId: { in: ids } },
    select: { id: true, guideId: true, canal: true, status: true, enviadoEm: true },
  }).catch(() => []);
  const taxDocs = await prisma.taxDocument.findMany({
    where: { guideId: { in: ids } },
    select: { id: true, guideId: true, sourceFileName: true },
  }).catch(() => []);
  const tributosParcela = await prisma.tributoParcela.findMany({
    where: { guideId: { in: ids } },
    select: { id: true, guideId: true, codigoTributo: true },
  }).catch(() => []);
  const parcelas = await prisma.parcela.findMany({
    where: { guiaId: { in: ids } },
    select: { id: true, guiaId: true },
  }).catch(() => []);
  const estornos = await prisma.estornoBaixa.findMany({
    where: { guideId: { in: ids } },
    select: { id: true, guideId: true },
  }).catch(() => []);

  // ---------- RELATÓRIO ----------
  for (const a of alvo) {
    const g = a.g;
    const p = pMap.get(g.portalClientId);
    const irmas = vizinhas.filter((v) => v.portalClientId === g.portalClientId && v.competencia === g.competencia && v.id !== g.id);
    const outra = irmas.find((v) => v.tipo === "OUTRA" && v.status === "PROCESSED");
    const mesmoValor = outra && Math.abs(Number(outra.valor) - Number(g.valor)) < 0.005;
    const mesmoVenc = outra && dia(outra.vencimento) === dia(g.vencimento);
    const classe = outra && mesmoValor && mesmoVenc ? "TEM_SUBSTITUTA" : "ORFA";

    console.log("\n" + "=".repeat(100));
    console.log(`[${classe}] ${p?.razao} — CNPJ ${p?.cnpj} — competência ${g.competencia} — R$ ${money(g.valor)}`);
    console.log(`  ERRADA  id=${g.id}`);
    console.log(`          tipo=${g.tipo} status=${g.status} source=${g.source} venc=${dia(g.vencimento)}`);
    console.log(`          sourceFileId=${g.sourceFileId}`);
    console.log(`          pay=${g.paymentStatus} email=${g.emailStatus} enviadoEm=${dia(g.emailSentAt)} liberada=${g.liberadaCliente} parcelamentoId=${g.parcelamentoId || "—"}`);
    console.log(`          criada=${ts(g.createdAt)} atualizada=${ts(g.updatedAt)} pdfBytes=${g.pdfBytes ? g.pdfBytes.length + "B" : "—"}`);
    console.log(`          PDF diz: ${a.itens.map((i) => `${i.codigo} ${i.denominacao || ""} total=${money(i.total)}`).join(" | ")}`);
    console.log(`          => tributos do documento: ${a.tributos.join("/")}  (total impresso ${money(a.totais?.total)})`);

    console.log(`  SUBSTITUTA (tipo=OUTRA, PROCESSED): ${outra ? `id=${outra.id} R$ ${money(outra.valor)} venc ${dia(outra.vencimento)} sourceFileId=${outra.sourceFileId} criada=${ts(outra.createdAt)}` : "NÃO EXISTE"}`);
    if (outra) console.log(`          mesmoValor=${mesmoValor} mesmoVencimento=${mesmoVenc} composicao=${JSON.stringify(outra.extracted?.composicao ?? null)}`);

    console.log(`  OUTRAS LINHAS na mesma empresa+competência (${irmas.length}):`);
    for (const v of irmas) {
      console.log(`      - id=${v.id} tipo=${v.tipo} status=${v.status} source=${v.source} valor=${money(v.valor)} valorOriginal=${money(v.valorOriginal)} venc=${dia(v.vencimento)}`);
      console.log(`        sourceFileId=${v.sourceFileId}  pdfBytes=${v.pdfBytes ? v.pdfBytes.length + "B" : "—"}  criada=${ts(v.createdAt)}  atualizada=${ts(v.updatedAt)}`);
      console.log(`        emailStatus=${v.emailStatus} paymentStatus=${v.paymentStatus} vazioEm=${ts(v.vazioEm)} vazioPor=${v.vazioPor || "—"} vazioMotivo=${v.vazioMotivo || "—"} reviewedBy=${v.reviewedByUserId || "—"} reviewedAt=${ts(v.reviewedAt)}`);
      const ex = v.extracted && typeof v.extracted === "object" ? v.extracted : null;
      if (ex) {
        const chaves = Object.keys(ex);
        console.log(`        extracted.chaves=[${chaves.join(", ")}] integrationSource=${ex.integrationSource ?? "—"} servico=${ex.servico ?? "—"} numeroDocumento=${ex.numeroDocumento ?? "—"} composicao=${JSON.stringify(ex.composicao ?? null)}`);
      } else {
        console.log(`        extracted=NULL`);
      }
    }

    console.log(`  A EXCLUSÃO ARRASTARIA:`);
    console.log(`      accounting_entries (sourceGuideId, onDelete:SetNull → NÃO apaga): ${entries.filter((e) => e.sourceGuideId === g.id).length}`);
    console.log(`      envios_guia         (onDelete:CASCADE → APAGA): ${envios.filter((e) => e.guideId === g.id).length}`);
    console.log(`      tributos_parcela    (onDelete:CASCADE → APAGA): ${tributosParcela.filter((e) => e.guideId === g.id).length}`);
    console.log(`      documents/TaxDocument (onDelete:SetNull → NÃO apaga): ${taxDocs.filter((e) => e.guideId === g.id).length}`);
    console.log(`      parcelas.guiaId     (onDelete:SetNull → NÃO apaga): ${parcelas.filter((e) => e.guiaId === g.id).length}`);
    console.log(`      estornos_baixa.guideId (sem FK, texto): ${estornos.filter((e) => e.guideId === g.id).length}`);

    const circ = await prisma.companyMonthlyCircular.findUnique({
      where: { portalClientId_competencia: { portalClientId: g.portalClientId, competencia: g.competencia } },
      select: { id: true, inssTotal: true, inssStatus: true, acrescimos: true },
    }).catch(() => null);
    console.log(`  CIRCULAR (NÃO tem FK para a guia — não é arrastada; fica como está por decisão do dono):`);
    console.log(`      id=${circ?.id ?? "—"} inssTotal=${money(circ?.inssTotal)} inssStatus=${circ?.inssStatus ?? "—"} acrescimos=${JSON.stringify(circ?.acrescimos ?? null)}`);
  }

  console.log("\n" + "=".repeat(100));
  console.log("RESUMO DA CLASSIFICAÇÃO");
  for (const a of alvo) {
    const p = pMap.get(a.g.portalClientId);
    const irmas = vizinhas.filter((v) => v.portalClientId === a.g.portalClientId && v.competencia === a.g.competencia && v.id !== a.g.id);
    const outra = irmas.find((v) => v.tipo === "OUTRA" && v.status === "PROCESSED");
    const ok = outra && Math.abs(Number(outra.valor) - Number(a.g.valor)) < 0.005 && dia(outra.vencimento) === dia(a.g.vencimento);
    console.log(`  ${ok ? "TEM_SUBSTITUTA" : "ORFA          "}  ${a.g.competencia}  R$ ${String(money(a.g.valor)).padStart(9)}  ${p?.razao}  id=${a.g.id}`);
  }
  console.log(`\nTOTAIS: alvo=${alvo.length}  lançamentos contábeis arrastados=${entries.length}  envios_guia=${envios.length}  tributos_parcela=${tributosParcela.length}  taxDocuments=${taxDocs.length}  parcelas=${parcelas.length}`);
}

main()
  .catch((e) => { console.error("FALHOU:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
