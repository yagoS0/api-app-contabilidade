// SOMENTE LEITURA. Não escreve nada, não chama SERPRO.
//
// Mede o defeito "guia de INSS em empresa que não tem INSS, com o valor do DARF de PIS/COFINS".
// Hipótese sob teste: o worker DCTFWeb (`syncSerproInssForCompany`) emite GERARGUIA31 e rotula
// o PDF resultante como `tipo:"INSS"` SEM olhar o regime nem `hasProlabore`. Na empresa de Lucro
// Presumido esse mesmo GERARGUIA31 é o DARF de PIS/COFINS/IRPJ/CSLL — que a captura do LP já
// gravou como `tipo:"OUTRA"`. Duas linhas, um documento.
//
//   node scripts/diag-inss-fantasma.mjs
//   node scripts/diag-inss-fantasma.mjs --competencia=2026-07

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const compFiltro = arg("competencia");
const num = (v) => (v == null ? null : Number(v));
const money = (v) => (v == null ? "—" : Number(v).toFixed(2));
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const linha = (s = "") => console.log(s);

async function main() {
  // ---------- 1. Universo de guias INSS ----------
  const inssGuides = await prisma.guide.findMany({
    where: {
      tipo: "INSS",
      status: { in: ["PROCESSED", "VAZIO"] },
      ...(compFiltro ? { competencia: compFiltro } : {}),
    },
    select: {
      id: true, portalClientId: true, competencia: true, valor: true, vencimento: true,
      status: true, source: true, sourceFileId: true, hash: true, extracted: true,
      parcelamentoId: true, paymentStatus: true, emailStatus: true, createdAt: true,
    },
  });

  const portalIds = [...new Set(inssGuides.map((g) => g.portalClientId).filter(Boolean))];
  const portais = await prisma.portalClient.findMany({
    where: { id: { in: portalIds } },
    select: { id: true, razao: true, cnpj: true, hasProlabore: true, temFolha: true, empresaZerada: true, status: true, companyId: true },
  });
  const pMap = new Map(portais.map((p) => [p.id, p]));
  const legacyIds = portais.map((p) => p.companyId).filter(Boolean);
  const legacy = legacyIds.length
    ? await prisma.company.findMany({ where: { id: { in: legacyIds } }, select: { id: true, regimeTributario: true, tipoTributario: true } })
    : [];
  const lMap = new Map(legacy.map((c) => [c.id, c]));
  const regimeDe = (p) => {
    const l = p?.companyId ? lMap.get(p.companyId) : null;
    return String(l?.regimeTributario || l?.tipoTributario || "").trim().toUpperCase() || "(indefinido)";
  };

  // ---------- 2. Guias OUTRA (DARF consolidado do LP) das mesmas empresas ----------
  const outras = await prisma.guide.findMany({
    where: {
      tipo: "OUTRA",
      portalClientId: { in: portalIds.length ? portalIds : ["__none__"] },
      ...(compFiltro ? { competencia: compFiltro } : {}),
    },
    select: {
      id: true, portalClientId: true, competencia: true, valor: true, vencimento: true,
      status: true, sourceFileId: true, hash: true, extracted: true, createdAt: true,
    },
  });
  const outraKey = new Map();
  for (const o of outras) outraKey.set(`${o.portalClientId}|${o.competencia}`, o);

  // ---------- 3. Rotina `inss` declarada por empresa ----------
  const rotinas = await prisma.companyRotina.findMany({
    where: { rotina: "inss", portalClientId: { in: portalIds.length ? portalIds : ["__none__"] } },
    select: { portalClientId: true, enabled: true },
  });
  const rotMap = new Map(rotinas.map((r) => [r.portalClientId, r.enabled]));

  // ---------- 4. Lançamentos contábeis originados nessas guias INSS ----------
  const entries = await prisma.accountingEntry.findMany({
    where: { sourceGuideId: { in: inssGuides.map((g) => g.id) } },
    select: { id: true, sourceGuideId: true, tipo: true, subtipo: true, eventType: true, competencia: true, valorTotal: true },
  }).catch(async () => prisma.accountingEntry.findMany({
    where: { sourceGuideId: { in: inssGuides.map((g) => g.id) } },
    select: { id: true, sourceGuideId: true, tipo: true, subtipo: true, eventType: true, competencia: true },
  }));
  const entriesPorGuia = new Map();
  for (const e of entries) {
    if (!entriesPorGuia.has(e.sourceGuideId)) entriesPorGuia.set(e.sourceGuideId, []);
    entriesPorGuia.get(e.sourceGuideId).push(e);
  }

  // ---------- 5. Circular (inssTotal / acrescimos.INSS) ----------
  const circulares = await prisma.companyMonthlyCircular.findMany({
    where: {
      portalClientId: { in: portalIds.length ? portalIds : ["__none__"] },
      ...(compFiltro ? { competencia: compFiltro } : {}),
    },
    select: { portalClientId: true, competencia: true, inssTotal: true, inssStatus: true, acrescimos: true },
  });
  const circMap = new Map(circulares.map((c) => [`${c.portalClientId}|${c.competencia}`, c]));

  // ================= RELATÓRIO =================
  linha(`Guias tipo=INSS analisadas: ${inssGuides.length}${compFiltro ? ` (competência ${compFiltro})` : " (todas as competências)"}`);
  linha();

  const suspeitas = [];
  const semProlabore = [];
  const naoSimples = [];

  for (const g of inssGuides) {
    const p = pMap.get(g.portalClientId);
    const regime = regimeDe(p);
    const par = outraKey.get(`${g.portalClientId}|${g.competencia}`);
    const mesmoValor = par && num(par.valor) != null && num(g.valor) != null && Math.abs(num(par.valor) - num(g.valor)) < 0.005;
    const mesmoVenc = par && dia(par.vencimento) === dia(g.vencimento);
    const docInss = g.extracted?.numeroDocumento ?? null;
    const docOutra = par?.extracted?.numeroDocumento ?? null;

    if (!p?.hasProlabore) semProlabore.push({ g, p, regime });
    if (regime && regime !== "SIMPLES") naoSimples.push({ g, p, regime });
    if (par && mesmoValor && mesmoVenc) suspeitas.push({ g, p, regime, par, docInss, docOutra });
  }

  linha("== A. PAR SUSPEITO: mesma empresa/competência, tipo INSS e tipo OUTRA com MESMO valor e MESMO vencimento ==");
  linha(`total de pares: ${suspeitas.length}`);
  linha();
  for (const s of suspeitas) {
    const ents = entriesPorGuia.get(s.g.id) || [];
    const circ = circMap.get(`${s.g.portalClientId}|${s.g.competencia}`);
    const comp = Array.isArray(s.par.extracted?.composicao) ? s.par.extracted.composicao : [];
    linha(`  ${s.p?.razao || "(sem portal)"} — CNPJ ${s.p?.cnpj || "?"} — comp ${s.g.competencia}`);
    linha(`    regime=${s.regime}  hasProlabore=${s.p?.hasProlabore}  temFolha=${s.p?.temFolha}  rotina.inss=${rotMap.get(s.g.portalClientId)}`);
    linha(`    INSS  id=${s.g.id} valor=${money(s.g.valor)} venc=${dia(s.g.vencimento)} status=${s.g.status} pay=${s.g.paymentStatus} email=${s.g.emailStatus}`);
    linha(`          sourceFileId=${s.g.sourceFileId}  hash=${s.g.hash ? s.g.hash.slice(0, 16) : "null"}  numeroDocumento=${s.docInss}  criada=${s.g.createdAt?.toISOString?.() || s.g.createdAt}`);
    linha(`    OUTRA id=${s.par.id} valor=${money(s.par.valor)} venc=${dia(s.par.vencimento)} status=${s.par.status}`);
    linha(`          sourceFileId=${s.par.sourceFileId}  hash=${s.par.hash ? s.par.hash.slice(0, 16) : "null"}  numeroDocumento=${s.docOutra}  criada=${s.par.createdAt?.toISOString?.() || s.par.createdAt}`);
    linha(`          composicao=${comp.map((c) => `${c.tributo || c.codigo}:${money(c.total)}`).join(" ") || "(vazia)"}`);
    linha(`    LANÇAMENTOS a partir da guia INSS: ${ents.length}${ents.length ? " -> " + ents.map((e) => `${e.tipo}/${e.subtipo}/${e.eventType}`).join(", ") : ""}`);
    linha(`    Circular: inssTotal=${money(circ?.inssTotal)} inssStatus=${circ?.inssStatus ?? "—"} acrescimos.INSS=${circ?.acrescimos?.INSS ? JSON.stringify(circ.acrescimos.INSS) : "—"}`);
    linha();
  }

  linha("== B. Guias INSS em empresa SEM pró-labore (hasProlabore=false) — o compliance não exige INSS ali ==");
  linha(`total: ${semProlabore.length}`);
  const porEmpresaB = new Map();
  for (const s of semProlabore) {
    const k = `${s.p?.razao || s.g.portalClientId} [${s.regime}] rotina.inss=${rotMap.get(s.g.portalClientId)}`;
    if (!porEmpresaB.has(k)) porEmpresaB.set(k, []);
    porEmpresaB.get(k).push(`${s.g.competencia}=${money(s.g.valor)}`);
  }
  for (const [k, v] of porEmpresaB) linha(`  ${k}: ${v.sort().join(", ")}`);
  linha();

  linha("== C. Guias INSS em empresa de regime != SIMPLES ==");
  const porRegime = {};
  for (const s of naoSimples) porRegime[s.regime] = (porRegime[s.regime] || 0) + 1;
  linha(`  ${JSON.stringify(porRegime)}`);
  linha();

  linha("== D. Lançamentos contábeis originados em QUALQUER guia tipo=INSS ==");
  linha(`  guias INSS com lançamento: ${entriesPorGuia.size} de ${inssGuides.length}`);
  for (const [gid, ents] of entriesPorGuia) {
    const g = inssGuides.find((x) => x.id === gid);
    const p = pMap.get(g?.portalClientId);
    linha(`    ${p?.razao || gid} comp=${g?.competencia} -> ${ents.map((e) => `${e.tipo}/${e.subtipo}/${e.eventType}/${e.competencia}`).join(", ")}`);
  }
  linha();

  linha("== E. Rotina `inss` ligada por regime (carteira inteira) ==");
  const todosPortais = await prisma.portalClient.findMany({
    where: { cnpj: { not: "" } },
    select: { id: true, razao: true, hasProlabore: true, companyId: true, status: true },
  });
  const todosLegacyIds = todosPortais.map((p) => p.companyId).filter(Boolean);
  const todosLegacy = todosLegacyIds.length
    ? await prisma.company.findMany({ where: { id: { in: todosLegacyIds } }, select: { id: true, regimeTributario: true, tipoTributario: true } })
    : [];
  const tlMap = new Map(todosLegacy.map((c) => [c.id, c]));
  const todasRotinas = await prisma.companyRotina.findMany({ where: { rotina: "inss" }, select: { portalClientId: true, enabled: true } });
  const trMap = new Map(todasRotinas.map((r) => [r.portalClientId, r.enabled]));
  const bucket = {};
  for (const p of todosPortais) {
    const l = p.companyId ? tlMap.get(p.companyId) : null;
    const reg = String(l?.regimeTributario || l?.tipoTributario || "").trim().toUpperCase() || "(indefinido)";
    const k = `${reg} | rotina.inss=${trMap.has(p.id) ? trMap.get(p.id) : "(sem linha)"} | hasProlabore=${p.hasProlabore}`;
    bucket[k] = (bucket[k] || 0) + 1;
  }
  for (const [k, v] of Object.entries(bucket).sort()) linha(`  ${k}: ${v}`);
  linha();
  linha(`total de empresas na carteira: ${todosPortais.length}`);
}

main()
  .catch((e) => { console.error("FALHOU:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
