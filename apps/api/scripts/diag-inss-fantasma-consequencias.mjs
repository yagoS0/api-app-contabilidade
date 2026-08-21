// SOMENTE LEITURA. Fecha a pergunta "qual foi a consequência?" para as guias `tipo:"INSS"` cujo
// PDF não tem NENHUMA contribuição previdenciária (só 8109/2172/2089/2372).
// Não escreve, não chama SERPRO.
//
//   node scripts/diag-inss-fantasma-consequencias.mjs

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseArrecadacaoComposicao, tributosSeNaoForPrevidenciario } from "../src/application/fiscal/serpro/parseArrecadacao.js";

const money = (v) => (v == null ? "—" : Number(v).toFixed(2));
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

async function main() {
  const pdfParse = (await import("pdf-parse")).default;
  const guides = await prisma.guide.findMany({
    where: { tipo: "INSS", status: "PROCESSED", source: "SERPRO" },
    select: {
      id: true, portalClientId: true, competencia: true, valor: true, vencimento: true,
      pdfBytes: true, paymentStatus: true, emailStatus: true, emailSentAt: true,
      liberadaCliente: true, liberadaEm: true, parcelamentoId: true, createdAt: true,
    },
    orderBy: { competencia: "asc" },
  });

  const suspeitas = [];
  for (const g of guides) {
    if (!g.pdfBytes) continue;
    let texto = "";
    try { texto = String((await pdfParse(Buffer.from(g.pdfBytes)))?.text || ""); } catch { continue; }
    const trib = tributosSeNaoForPrevidenciario(parseArrecadacaoComposicao(texto).itens);
    if (trib) suspeitas.push({ ...g, tributos: trib });
  }

  const pIds = [...new Set(suspeitas.map((s) => s.portalClientId))];
  const portais = await prisma.portalClient.findMany({ where: { id: { in: pIds } }, select: { id: true, razao: true, cnpj: true } });
  const pMap = new Map(portais.map((p) => [p.id, p]));

  const ids = suspeitas.map((s) => s.id);
  const entries = await prisma.accountingEntry.findMany({
    where: { sourceGuideId: { in: ids } },
    select: { id: true, sourceGuideId: true, tipo: true, subtipo: true, eventType: true, competencia: true },
  });
  const envios = await prisma.envioGuia.findMany({
    where: { guiaId: { in: ids } },
    select: { guiaId: true, canal: true, status: true, enviadoEm: true },
  }).catch(() => []);

  console.log(`Guias tipo=INSS cujo PDF NÃO tem contribuição previdenciária: ${suspeitas.length} (de ${guides.length} analisadas)\n`);
  for (const s of suspeitas) {
    const p = pMap.get(s.portalClientId);
    const ents = entries.filter((e) => e.sourceGuideId === s.id);
    const envs = envios.filter((e) => e.guiaId === s.id);
    const circ = await prisma.companyMonthlyCircular.findUnique({
      where: { portalClientId_competencia: { portalClientId: s.portalClientId, competencia: s.competencia } },
      select: { inssTotal: true, inssStatus: true, acrescimos: true },
    }).catch(() => null);
    const outra = await prisma.guide.findFirst({
      where: { portalClientId: s.portalClientId, competencia: s.competencia, tipo: "OUTRA" },
      select: { id: true, valor: true, vencimento: true },
    });
    console.log(`${p?.razao} — ${p?.cnpj} — ${s.competencia} — R$ ${money(s.valor)} venc ${dia(s.vencimento)} [${s.tributos.join("/")}]`);
    console.log(`   guiaId=${s.id}  pay=${s.paymentStatus}  emailStatus=${s.emailStatus}  emailSentAt=${dia(s.emailSentAt)}  liberadaCliente=${s.liberadaCliente}  parcelamentoId=${s.parcelamentoId || "—"}`);
    console.log(`   LANÇAMENTOS: ${ents.length ? ents.map((e) => `${e.id} ${e.tipo}/${e.subtipo}/${e.competencia}`).join(" ; ") : "NENHUM"}`);
    console.log(`   ENVIOS (envios_guia): ${envs.length ? envs.map((e) => `${e.canal}/${e.status}/${dia(e.enviadoEm)}`).join(" ; ") : "nenhuma linha"}`);
    console.log(`   CIRCULAR: inssTotal=${money(circ?.inssTotal)} inssStatus=${circ?.inssStatus ?? "—"} acrescimos.INSS=${circ?.acrescimos?.INSS ? JSON.stringify(circ.acrescimos.INSS) : "—"}`);
    console.log(`   guia "OUTRA" da mesma competência: ${outra ? `${outra.id} R$ ${money(outra.valor)} venc ${dia(outra.vencimento)}` : "NÃO EXISTE"}`);
    console.log();
  }
}

main()
  .catch((e) => { console.error("FALHOU:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
