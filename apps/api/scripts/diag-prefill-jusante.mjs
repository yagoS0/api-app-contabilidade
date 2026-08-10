// DIAGNÓSTICO (SÓ LEITURA): o valor pré-preenchido errado JÁ ESCAPOU?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum ato fiscal.
//
// Perguntas:
//   [A] snapshots (calculada/fechada/transmitida): a receita gravada bate com o faturamento real?
//   [B] o "bate" do prefill vem de qual origem? (cnae acerta o total; memoria acerta por acaso?)
//   [C] se a linha do CNAE deixar de ser emitida, quantas empresas PERDEM o anexo?
//   [D] a memória: um registro por empresa (sem competência)? quando foi gravada?

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const money = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const padL = (s, n) => String(s ?? "").slice(0, n).padStart(n);
const round2 = (n) => +Number(n || 0).toFixed(2);
function rangeMes(c) { const [y, m] = c.split("-").map(Number); return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }; }

try {
  console.log("=".repeat(120));

  // ─── [A] SNAPSHOTS × FATURAMENTO REAL ────────────────────────────────────────────────────────
  const snaps = await prisma.apuracaoSnapshot.findMany({
    select: {
      portalClientId: true, competencia: true, estado: true,
      receitaInterna: true, receitaExterna: true, atividadesEscolhidas: true,
      dasCalculadoLocal: true, numeroDeclaracao: true, transmitidoEm: true, updatedAt: true,
    },
    orderBy: { competencia: "asc" },
  });
  const clientes = await prisma.portalClient.findMany({ select: { id: true, razao: true, cnpj: true } });
  const nomePorId = new Map(clientes.map((c) => [c.id, c.razao]));

  console.log(`[A] ApuracaoSnapshot: ${snaps.length} registros`);
  const porEstado = {};
  for (const s of snaps) porEstado[s.estado] = (porEstado[s.estado] || 0) + 1;
  console.log(`    por estado: ${Object.entries(porEstado).map(([k, v]) => `${k}=${v}`).join("  ")}`);

  console.log(`\n    ${pad("comp", 8)}${pad("razao", 30)}${pad("estado", 12)}${padL("snapshot", 14)}${padL("fat real", 14)}${padL("delta", 14)}  ${pad("nDecl", 20)}`);
  let divSnap = 0;
  for (const s of snaps) {
    const { gte, lt } = rangeMes(s.competencia);
    const agg = await prisma.portalInvoice.aggregate({
      where: { papel: "EMIT", statusEfetivo: "autorizada", clientId: s.portalClientId, competencia: { gte, lt } },
      _sum: { total: true },
    });
    const fatReal = round2(Number(agg._sum?.total || 0));
    const gravado = round2(Number(s.receitaInterna || 0) + Number(s.receitaExterna || 0));
    const delta = round2(gravado - fatReal);
    const marca = Math.abs(delta) > 0.01 ? "  <<< DIVERGE" : "";
    if (Math.abs(delta) > 0.01) divSnap += 1;
    console.log(`    ${pad(s.competencia, 8)}${pad(nomePorId.get(s.portalClientId), 30)}${pad(s.estado, 12)}${padL(money(gravado), 14)}${padL(money(fatReal), 14)}${padL(money(delta), 14)}  ${pad(s.numeroDeclaracao || "-", 20)}${marca}`);
  }
  console.log(`    → ${divSnap} de ${snaps.length} snapshots com receita diferente do faturamento real.`);

  // ─── [D] MEMÓRIA ─────────────────────────────────────────────────────────────────────────────
  const mems = await prisma.apuracaoConfigMemory.findMany();
  console.log(`\n[D] ApuracaoConfigMemory — ${mems.length} registros (chave = portalClientId; NÃO tem competência)`);
  console.log(`    ${pad("razao", 32)}${pad("atualizadoEm", 22)}${padL("soma gravada", 16)}  ${pad("anexos", 10)}  atividades`);
  for (const m of mems) {
    const l = Array.isArray(m.atividadesEscolhidas) ? m.atividadesEscolhidas : [];
    const soma = round2(l.reduce((s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0));
    const anexos = [...new Set(l.map((a) => a?.anexoImplicito).filter(Boolean))].join("/");
    console.log(`    ${pad(nomePorId.get(m.portalClientId), 32)}${pad(new Date(m.atualizadoEm).toISOString().slice(0, 19), 22)}${padL(money(soma), 16)}  ${pad(anexos || "-", 10)}  ${l.length}`);
  }

  // ─── [C] QUEM PERDE O ANEXO SE A LINHA DO CNAE SUMIR ─────────────────────────────────────────
  const cadastros = await prisma.cadastroFiscal.findMany({ select: { portalClientId: true, cnaePrincipal: true } });
  const cadPorId = new Map(cadastros.map((c) => [c.portalClientId, c.cnaePrincipal]));
  const pcs = await prisma.portalClient.findMany({ select: { id: true, razao: true, companyId: true } });
  const companies = await prisma.company.findMany({ select: { id: true, cnaePrincipal: true } });
  const compPorId = new Map(companies.map((c) => [c.id, c.cnaePrincipal]));
  const cnaeRows = await prisma.cnaeAnexo.findMany({ select: { cnae: true, tipoReceitaSugerido: true } });
  const cnaeMap = new Map(cnaeRows.map((r) => [r.cnae, r.tipoReceitaSugerido]));
  const memIds = new Set(mems.map((m) => m.portalClientId));

  let comCnaeUtil = 0, semCnae = 0, semDeParaCnae = 0;
  const perderiamAnexo = [];
  for (const p of pcs) {
    const cnae = String(cadPorId.get(p.id) || compPorId.get(p.companyId) || "").replace(/\D+/g, "");
    if (cnae.length < 7) { semCnae += 1; continue; }
    const tipo = cnaeMap.get(cnae.slice(0, 7));
    if (!tipo) { semDeParaCnae += 1; continue; }
    comCnaeUtil += 1;
    if (!memIds.has(p.id)) perderiamAnexo.push({ razao: p.razao, cnae, tipo });
  }
  console.log(`\n[C] CNAE → anexo: ${pcs.length} empresas; com CNAE mapeável = ${comCnaeUtil}; sem CNAE = ${semCnae}; CNAE sem de-para em CnaeAnexo = ${semDeParaCnae}`);
  console.log(`    CnaeAnexo tem ${cnaeRows.length} linhas.`);
  console.log(`    Empresas cujo ÚNICO caminho pro anexo é o CNAE (não têm memória): ${perderiamAnexo.length}`);
  for (const e of perderiamAnexo.slice(0, 30)) console.log(`      ${pad(e.razao, 40)} cnae=${e.cnae}  tipo=${e.tipo}`);

  console.log("\n" + "=".repeat(120));
} catch (err) {
  console.error("ERRO:", err?.message || err, "\n", err?.stack);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
