// SOMENTE LEITURA. Aplica o modulo `lib/disponibilidades.js` no plano REAL e mostra o resultado
// inteiro — inclusive as contas que ele NAO sabe classificar, que e o ponto.
import { PrismaClient } from "@prisma/client";
import { separarDisponibilidades, conferirAncoras } from "../src/application/accounting/lib/disponibilidades.js";
const p = new PrismaClient();
const contas = await p.chartOfAccount.findMany({
  select: { codigo: true, codigoCompleto: true, nome: true, portalClientId: true },
});
for (const escopo of ["GLOBAL", "EMPRESA"]) {
  const lista = contas.filter((c) => (escopo === "GLOBAL" ? !c.portalClientId : c.portalClientId));
  console.log(`\n########## ESCOPO ${escopo} (n=${lista.length}) ##########`);
  const anc = conferirAncoras(lista);
  console.log("tripwire das ancoras:", anc.ok ? "OK" : "PROBLEMA");
  for (const pr of anc.problemas) console.log(`   ⚠ ${pr.codigoCompleto}: esperado "${pr.esperado}" / encontrado ${pr.encontrado === null ? "(ausente)" : `"${pr.encontrado}"`}`);
  const r = separarDisponibilidades(lista);
  const mostrar = (titulo, arr) => {
    console.log(`\n-- ${titulo}: ${arr.length}`);
    for (const c of arr) console.log(`     ${String(c.codigoCompleto).padEnd(11)} red=${String(c.codigo).padEnd(6)} ${c.nome}`);
  };
  mostrar("CAIXA", r.caixa);
  mostrar("BANCOS", r.bancos);
  mostrar("APLICACOES", r.aplicacoes);
  mostrar("⚠ DISPONIVEL, ramo desconhecido (contador decide)", r.disponiveisNaoClassificadas);
  mostrar("⚠ INDETERMINADO — sem codigoCompleto (contador decide)", r.indeterminadas);
  console.log(`\n-- NAO_DISPONIVEL (afirmado): ${r.naoDisponiveis.length}`);
}
await p.$disconnect();
