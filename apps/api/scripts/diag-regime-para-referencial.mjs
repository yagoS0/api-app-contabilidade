// SOMENTE LEITURA. Censo de REGIME da carteira, para decidir se o plano referencial da RFB
// (ECD/ECF) importa para nos.
//
// ⚠ A ARMADILHA QUE ESTE SCRIPT EXISTE PARA NAO REPETIR: medir regime por `CadastroFiscal.regime`
// SUBESTIMA. CadastroFiscal e a autoridade ONDE EXISTE, mas cobre uma fracao da carteira. O regime
// de toda a carteira mora em `Company.regimeTributario` (via PortalClient.companyId).
// As duas fontes usam GRAFIAS DIFERENTES: CadastroFiscal grava "SIMPLES_NACIONAL",
// Company grava "SIMPLES". Ver `application/nfse/dpsCodigos.js`.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const clientes = await p.portalClient.findMany({ select: { id: true, razao: true, companyId: true } });
const cads = await p.cadastroFiscal.findMany({ select: { portalClientId: true, regime: true } });
const companies = await p.company.findMany({ select: { id: true, razaoSocial: true, regimeTributario: true, tipoTributario: true } });
const cadPorCliente = new Map(cads.map((c) => [c.portalClientId, c.regime]));
const compPorId = new Map(companies.map((c) => [c.id, c]));

const conta = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

console.log("=== AS DUAS FONTES, LADO A LADO (clientes:", clientes.length, ") ===");
const fCad = {}, fComp = {};
for (const c of clientes) {
  conta(fCad, cadPorCliente.get(c.id) || "(sem CadastroFiscal)");
  const comp = compPorId.get(c.companyId);
  conta(fComp, comp?.regimeTributario || comp?.tipoTributario || "(sem Company/regime)");
}
console.log("\n-- CadastroFiscal.regime (autoridade, mas COBERTURA PARCIAL):");
for (const [k, n] of Object.entries(fCad).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(26)} ${String(n).padStart(3)}`);
console.log("\n-- Company.regimeTributario (a carteira inteira):");
for (const [k, n] of Object.entries(fComp).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(26)} ${String(n).padStart(3)}`);
console.log(`\ncobertura do CadastroFiscal: ${cads.length}/${clientes.length} (${(cads.length * 100 / clientes.length).toFixed(1)}%)`);

// Regime EFETIVO: CadastroFiscal manda ONDE EXISTE; Company e o fallback. Grafias normalizadas.
const normalizar = (v) => {
  const r = String(v || "").trim().toUpperCase();
  if (!r) return null;
  if (r === "SIMPLES" || r === "SIMPLES_NACIONAL") return "SIMPLES_NACIONAL";
  if (r === "PRESUMIDO" || r === "LUCRO_PRESUMIDO") return "LUCRO_PRESUMIDO";
  if (r === "REAL" || r === "LUCRO_REAL") return "LUCRO_REAL";
  return r;
};
console.log("\n=== REGIME EFETIVO (CadastroFiscal onde existe; senao Company) ===");
const efetivo = {}; const presumidos = [];
for (const c of clientes) {
  const comp = compPorId.get(c.companyId);
  const r = normalizar(cadPorCliente.get(c.id)) || normalizar(comp?.regimeTributario || comp?.tipoTributario) || "(INDETERMINADO)";
  conta(efetivo, r);
  if (r === "LUCRO_PRESUMIDO" || r === "LUCRO_REAL") presumidos.push({ razao: c.razao || comp?.razaoSocial, r });
}
for (const [k, n] of Object.entries(efetivo).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(26)} ${String(n).padStart(3)}  (${(n * 100 / clientes.length).toFixed(1)}%)`);
console.log("\n-- as empresas fora do Simples, NOMEADAS (candidatas a ECD):");
for (const x of presumidos) console.log(`     ${x.r.padEnd(18)} ${x.razao}`);
console.log("\ntotal fora do Simples:", presumidos.length);

// ⚠ divergencia entre as duas fontes, onde as duas existem
console.log("\n=== ⚠ DIVERGENCIA entre CadastroFiscal e Company (onde as DUAS existem) ===");
let div = 0;
for (const c of clientes) {
  const a = normalizar(cadPorCliente.get(c.id));
  const comp = compPorId.get(c.companyId);
  const b = normalizar(comp?.regimeTributario || comp?.tipoTributario);
  if (a && b && a !== b) { div++; console.log(`     ${c.razao || comp?.razaoSocial}: CadastroFiscal=${a} vs Company=${b}`); }
}
console.log("divergencias:", div);

const comContaPropria = await p.chartOfAccount.groupBy({ by: ["portalClientId"], where: { portalClientId: { not: null } }, _count: true });
console.log("\nclientes com plano de contas PROPRIO:", comContaPropria.length, "| os demais usam so o GLOBAL");
await p.$disconnect();
