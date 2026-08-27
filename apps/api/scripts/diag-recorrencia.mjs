// SÓ LEITURA. A cobertura que a Fase D precisa ANTES de escrever o detector.
//
// O plano diz: "⚠ `tomadorDoc` e `emitenteDoc` são ANULÁVEIS — cobertura A MEDIR antes de
// construir; sem documento, a linha cai na âncora de descrição." Este script mede.
//
// ⚠⚠ ELE MEDE COM O PRÓPRIO DETECTOR, e não com uma segunda conta. A primeira versão reimplementava
// mediana e CV aqui — e a mediana daqui divergia da de lá em lista PAR (pegava o central superior).
// Um diagnóstico que usa outra aritmética mede outra coisa e diz que mediu esta.
import { ORIGEM } from "../src/application/declarados/lib/estadosDeclarado.js";
import {
  PERIODICIDADE,
  PISO_DE_OBSERVACOES,
  ciclosConsecutivosNoFim,
  coeficienteDeVariacao,
  mediana,
  porCiclo,
} from "../src/application/fluxo/lib/recorrencia.js";
import { prisma } from "../src/infrastructure/db/prisma.js";

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

/**
 * ⚠⚠ NOTA CANCELADA NÃO É OBSERVAÇÃO DE SÉRIE — e o critério é o de `derivarCiclo`, com as DUAS
 * colunas.
 *
 * A primeira versão olhava só `statusEfetivo === "cancelada"`. `statusEfetivo` é `String?`, e o
 * vocabulário de `status` tem literalmente `CANCELADA`: uma nota cancelada com `statusEfetivo` nulo
 * entrava como observação de receita recorrente. `application/notas/cicloNota.js` já lê as duas.
 *
 * ⚠ E aqui é por EXCLUSÃO, ao contrário da definição de faturamento da casa
 * (`whereFaturamentoEmit` = `{papel:"EMIT", statusEfetivo:"autorizada"}`, de INCLUSÃO). O motivo é
 * que não existe equivalente para o lado DEST — nota RECEBIDA não passa pelo nosso ciclo de
 * autorização —, e usar "autorizada" lá cortaria a despesa inteira. A assimetria é DITA na saída.
 */
const foiCancelada = (l) =>
  String(l?.statusEfetivo || "").toLowerCase() === "cancelada"
  || String(l?.status || "").toUpperCase() === "CANCELADA";

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
      select: { clientId: true, [campo]: true, competencia: true, total: true, statusEfetivo: true, status: true },
    });
    let canceladas = 0;
    const porPar = new Map();
    for (const l of linhas) {
      if (foiCancelada(l)) { canceladas += 1; continue; }
      const chave = `${l.clientId}|${l[campo]}`;
      if (!porPar.has(chave)) porPar.set(chave, []);
      // ⚠ Acessadores UTC de propósito: é o MESMO caminho de `ingestaoNfse.js`, que é quem escreve
      // esta coluna. A query já filtra `competencia: { not: null }`, então `new Date(null)` = 1970
      // não é alcançável.
      const mes = new Date(l.competencia);
      if (Number.isNaN(mes.getTime())) continue;
      const comp = `${mes.getUTCFullYear()}-${String(mes.getUTCMonth() + 1).padStart(2, "0")}`;
      porPar.get(chave).push({ competencia: comp, valor: Number(l.total) });
    }
    console.log(`   canceladas descartadas  ${canceladas}   ⚠ critério de \`derivarCiclo\`: as DUAS colunas`);

    // ⚠⚠ AS DUAS CONTAGENS SÃO DIFERENTES, e confundi-las foi o defeito da primeira versão: o
    // rótulo dizia "⚠ o PISO do plano" sobre competências DISTINTAS, e o piso do detector é sobre
    // as CONSECUTIVAS — que é o ponto inteiro do desenho ("jan/mar/mai são 3 observações e 1
    // consecutiva"). O número distinto é um TETO, não a contagem de séries sugeríveis.
    const series = [...porPar.values()].map((obs) => {
      const ciclos = porCiclo(obs, PERIODICIDADE.MENSAL);
      return { ciclos, distintas: ciclos.length, consecutivas: ciclosConsecutivosNoFim(ciclos) };
    });
    const distintas3 = series.filter((s) => s.distintas >= PISO_DE_OBSERVACOES).length;
    const noPiso = series.filter((s) => s.consecutivas >= PISO_DE_OBSERVACOES).length;
    console.log(`   pares (empresa × contraparte) ... ${porPar.size}`);
    console.log(`     ⤷ com ${PISO_DE_OBSERVACOES}+ ciclos DISTINTOS .... ${distintas3}  (${pct(distintas3, porPar.size)})   ⚠ é um TETO, não o piso`);
    console.log(`     ⤷ com ${PISO_DE_OBSERVACOES}+ CONSECUTIVOS no fim . ${noPiso}  (${pct(noPiso, porPar.size)})   ⚠⚠ ESTE é o piso do detector`);
    console.log(`     ⤷ com 6+ distintos ........... ${series.filter((s) => s.distintas >= 6).length}`);
    console.log(`     ⤷ com 12+ distintos .......... ${series.filter((s) => s.distintas >= 12).length}`);
    console.log(`     ⤷ a maior série .............. ${Math.max(0, ...series.map((s) => s.distintas))} competências`);
    console.log("     ⚠ leitura MENSAL. A taxa ANUAL do Conselho contaria em 'distintos' e seria");
    console.log("       recusada aqui — ela só passa no piso lida como ANUAL.");

    // ⚠ A DISPERSÃO decide se a mediana significa alguma coisa. O plano cita "Claude 120–140".
    // ⚠ CV e mediana vêm do DETECTOR — a conta que a tela vai mostrar, não uma parecida.
    const cvs = series
      .filter((s) => s.consecutivas >= PISO_DE_OBSERVACOES)
      .map((s) => coeficienteDeVariacao(s.ciclos.map((c) => c.valor)))
      .filter((x) => x != null)
      .sort((a, b) => a - b);
    if (cvs.length) {
      const estaveis = cvs.filter((c) => c <= 0.15).length;
      console.log(`     ⤷ CV mediano das séries no piso  ${(mediana(cvs) * 100).toFixed(1)}%`);
      console.log(`     ⤷ séries com CV <= 15% ....... ${estaveis} de ${cvs.length}  (${pct(estaveis, cvs.length)})`);
    }
  }

  console.log("\n── DESPESA SEM NOTA (débito de OFX)");
  // ⚠ A tabela pode não existir (migration `20260824120000` não aplicada) — P2021. Isso NÃO pode
  // derrubar o script depois de ele já ter impresso a parte útil.
  try {
    const decl = await prisma.lancamentoDeclarado.count();
    const declOfx = await prisma.lancamentoDeclarado.count({ where: { origem: ORIGEM.OFX_CLIENTE } });
    console.log(`   lancamentos_declarados ...... ${decl}`);
    console.log(`   ⤷ de OFX .................... ${declOfx}   ⚠ é a fonte da despesa sem nota`);
  } catch (e) {
    console.log(`   ⚠ não medido: ${e?.code === "P2021" ? "a tabela ainda não existe (migration não aplicada)" : e?.message}`);
  }

  console.log("\n" + "=".repeat(78));
  console.log("⚠ ESTE É O BANCO LOCAL, NÃO A CARTEIRA. Os números de produção são outros.");
}

main()
  .catch((e) => { console.error("falhou:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
