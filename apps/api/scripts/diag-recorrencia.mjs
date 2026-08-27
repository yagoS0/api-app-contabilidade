// SÓ LEITURA. A cobertura que a Fase D precisa ANTES de escrever o detector.
//
// O plano diz: "⚠ `tomadorDoc` e `emitenteDoc` são ANULÁVEIS — cobertura A MEDIR antes de
// construir; sem documento, a linha cai na âncora de descrição." Este script mede.
import { prisma } from "../src/infrastructure/db/prisma.js";

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

async function main() {
  console.log("=".repeat(78));
  console.log("A MATÉRIA-PRIMA DA RECORRÊNCIA — o que existe neste banco");
  console.log("=".repeat(78));

  for (const papel of ["EMIT", "DEST"]) {
    const campo = papel === "EMIT" ? "tomadorDoc" : "emitenteDoc";
    const total = await prisma.portalInvoice.count({ where: { papel } });
    const comDoc = await prisma.portalInvoice.count({ where: { papel, [campo]: { not: null } } });
    const comComp = await prisma.portalInvoice.count({ where: { papel, competencia: { not: null } } });
    const comValor = await prisma.portalInvoice.count({ where: { papel, total: { not: null } } });
    const lado = papel === "EMIT" ? "RECEITA" : "DESPESA";
    console.log(`\n── ${lado} (papel ${papel}, chave ${campo})`);
    console.log(`   notas ................. ${total}`);
    console.log(`   com ${campo.padEnd(12)} ... ${comDoc}  (${pct(comDoc, total)})   ⚠ é a CHAVE da série`);
    console.log(`   com competencia ....... ${comComp}  (${pct(comComp, total)})`);
    console.log(`   com total ............. ${comValor}  (${pct(comValor, total)})`);
    if (!total) continue;

    // ⚠ O que decide se o detector tem o que detectar: pares (empresa × contraparte) com N notas
    // em competências DISTINTAS. O piso do plano é 3.
    const linhas = await prisma.portalInvoice.findMany({
      where: { papel, [campo]: { not: null }, competencia: { not: null }, total: { not: null } },
      select: { clientId: true, [campo]: true, competencia: true, total: true, statusEfetivo: true },
    });
    const porPar = new Map();
    for (const l of linhas) {
      // ⚠ Nota cancelada NÃO conta — ela não é receita nem despesa recorrente.
      if (String(l.statusEfetivo || "").toLowerCase() === "cancelada") continue;
      const chave = `${l.clientId}|${l[campo]}`;
      if (!porPar.has(chave)) porPar.set(chave, new Map());
      const mes = new Date(l.competencia);
      if (Number.isNaN(mes.getTime())) continue;
      const comp = `${mes.getUTCFullYear()}-${String(mes.getUTCMonth() + 1).padStart(2, "0")}`;
      const meses = porPar.get(chave);
      meses.set(comp, (meses.get(comp) || 0) + Number(l.total));
    }
    const tamanhos = [...porPar.values()].map((m) => m.size);
    const com3 = tamanhos.filter((n) => n >= 3).length;
    const com6 = tamanhos.filter((n) => n >= 6).length;
    const com12 = tamanhos.filter((n) => n >= 12).length;
    console.log(`   pares (empresa × contraparte) ... ${porPar.size}`);
    console.log(`     ⤷ com 3+ competências ........ ${com3}  (${pct(com3, porPar.size)})   ⚠ o PISO do plano`);
    console.log(`     ⤷ com 6+ ..................... ${com6}`);
    console.log(`     ⤷ com 12+ .................... ${com12}`);
    const maior = Math.max(0, ...tamanhos);
    console.log(`     ⤷ a maior série .............. ${maior} competências`);

    // ⚠ A DISPERSÃO decide se a mediana significa alguma coisa. O plano cita "Claude 120–140".
    const candidatos = [...porPar.entries()].filter(([, m]) => m.size >= 3);
    if (candidatos.length) {
      const cvs = candidatos.map(([, m]) => {
        const vs = [...m.values()];
        const media = vs.reduce((a, b) => a + b, 0) / vs.length;
        if (!media) return null;
        const dp = Math.sqrt(vs.reduce((a, b) => a + (b - media) ** 2, 0) / vs.length);
        return dp / Math.abs(media);
      }).filter((x) => x != null).sort((a, b) => a - b);
      const mediana = cvs[Math.floor(cvs.length / 2)];
      const estaveis = cvs.filter((c) => c <= 0.15).length;
      console.log(`     ⤷ CV mediano das séries ...... ${(mediana * 100).toFixed(1)}%`);
      console.log(`     ⤷ séries com CV <= 15% ....... ${estaveis} de ${cvs.length}  (${pct(estaveis, cvs.length)})`);
    }
  }

  console.log("\n── DESPESA SEM NOTA (débito de OFX)");
  const decl = await prisma.lancamentoDeclarado.count();
  const declOfx = await prisma.lancamentoDeclarado.count({ where: { origem: "OFX_CLIENTE" } });
  console.log(`   lancamentos_declarados ...... ${decl}`);
  console.log(`   ⤷ de OFX .................... ${declOfx}   ⚠ é a fonte da despesa sem nota`);

  console.log("\n" + "=".repeat(78));
  console.log("⚠ ESTE É O BANCO LOCAL, NÃO A CARTEIRA. Os números de produção são outros.");
}

main()
  .catch((e) => { console.error("falhou:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
