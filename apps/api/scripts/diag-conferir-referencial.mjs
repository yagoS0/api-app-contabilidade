// SOMENTE LEITURA. Confere 3 afirmacoes do agente.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

// 1) "55 contas dizem caixa/banco no nome, so 38 estao sob 111"
const todas = await p.chartOfAccount.findMany({ select: { codigoCompleto: true, nome: true } });
const porNome = todas.filter(c => /caixa|banco/i.test(c.nome || ""));
const sob111 = porNome.filter(c => String(c.codigoCompleto || "").startsWith("111"));
console.log("=== NOME diz caixa/banco ===");
console.log("  por NOME:", porNome.length, "| sob prefixo 111:", sob111.length, "| FORA:", porNome.length - sob111.length);
console.log("  as que ficariam de fora (amostra):");
for (const c of porNome.filter(c => !String(c.codigoCompleto||"").startsWith("111")).slice(0, 8))
  console.log(`    ${String(c.codigoCompleto).padEnd(10)} ${c.nome}`);

// 2) regime das empresas -- o agente disse "4 com cadastro, todas SIMPLES, zero Presumido"
const cad = await p.cadastroFiscal.findMany({ select: { regime: true } }).catch(() => null);
console.log("\n=== CadastroFiscal.regime ===");
if (!cad) console.log("  (modelo nao encontrado)");
else { const m={}; for (const c of cad) m[c.regime||"(nulo)"]=(m[c.regime||"(nulo)"]||0)+1; console.log(" ", JSON.stringify(m), "| total:", cad.length); }

// 3) o regime "de verdade" mora em outro lugar?
for (const modelo of ["company", "portalClient"]) {
  try {
    const r = await p[modelo].findMany({ select: { regimeTributario: true } });
    const m = {}; for (const x of r) m[x.regimeTributario || "(nulo)"] = (m[x.regimeTributario || "(nulo)"] || 0) + 1;
    console.log(`\n=== ${modelo}.regimeTributario ===\n  ${JSON.stringify(m)} | total: ${r.length}`);
  } catch { /* campo nao existe nesse modelo */ }
}
await p.$disconnect();
