/**
 * ⚠⚠ O QUE A VARREDURA TRARIA — só LEITURA, nada é criado.
 *
 * A data-piso é decisão do CONTADOR, de propósito: sem piso a primeira varredura despeja a base
 * inteira na fila, e um piso escolhido pelo sistema faria o sistema decidir o tamanho do trabalho
 * que ele vai encontrar na tela. Este script existe para essa escolha ser feita **com números na
 * mão**, e não no escuro.
 *
 * Para cada empresa: quantas notas RECEBIDAS existem a partir de cada piso candidato, e quantas
 * delas JÁ viraram fila (essas voltariam como `jaExistiam`, sem nada ser tocado).
 *
 *   node scripts/diag-previa-da-varredura.mjs [AAAA-MM-DD ...]
 */
import { prisma } from "../src/infrastructure/db/prisma.js";

const PISOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["2026-08-01", "2026-07-01", "2026-01-01"];

const dia = (iso) => new Date(`${iso}T00:00:00.000Z`);

async function main() {
  const empresas = await prisma.portalClient.findMany({
    select: { id: true, razao: true, cnpj: true },
    orderBy: { razao: "asc" },
  });

  let ligadas = [];
  try {
    ligadas = await prisma.varreduraAutomaticaDeNotas.findMany({
      select: { portalClientId: true, dataPiso: true, ultimaTentativaEm: true, ultimoCriados: true },
    });
  } catch (e) {
    console.log(`⚠ tabela da varredura automática indisponível (${e?.code || e?.message})`);
  }
  const porEmpresa = new Map(ligadas.map((l) => [l.portalClientId, l]));

  console.log(`\nEMPRESAS: ${empresas.length} · com varredura automática LIGADA: ${ligadas.length}\n`);
  console.log(`${"empresa".padEnd(32)} | ${PISOS.map((p) => p.padEnd(12)).join(" | ")} | na fila hoje | automática`);
  console.log("-".repeat(32 + PISOS.length * 15 + 32));

  const totais = Object.fromEntries(PISOS.map((p) => [p, 0]));

  for (const e of empresas) {
    const contagens = [];
    for (const piso of PISOS) {
      // eslint-disable-next-line no-await-in-loop
      const n = await prisma.portalInvoice.count({
        where: { clientId: e.id, papel: "DEST", issueDate: { gte: dia(piso) } },
      });
      contagens.push(n);
      totais[piso] += n;
    }
    // eslint-disable-next-line no-await-in-loop
    const naFila = await prisma.lancamentoDeclarado.count({
      where: { portalClientId: e.id, origem: "NOTA_RECEBIDA" },
    });
    const auto = porEmpresa.get(e.id);
    const marca = auto
      ? `desde ${auto.dataPiso?.toISOString?.().slice(0, 10)}${auto.ultimaTentativaEm ? "" : " (nunca varreu)"}`
      : "—";

    // ⚠ Empresa sem nota recebida nenhuma some do relatório? NÃO: ela aparece com zero. "Não tem
    // nota" e "não olhei" são respostas diferentes, e é a distinção que este projeto persegue.
    console.log(
      `${(e.razao || e.id).slice(0, 32).padEnd(32)} | `
      + `${contagens.map((n) => String(n).padEnd(12)).join(" | ")} | `
      + `${String(naFila).padEnd(12)} | ${marca}`,
    );
  }

  console.log("-".repeat(32 + PISOS.length * 15 + 32));
  console.log(
    `${"TOTAL".padEnd(32)} | ${PISOS.map((p) => String(totais[p]).padEnd(12)).join(" | ")}`,
  );
  console.log(
    "\n⚠ As colunas de piso contam NOTAS RECEBIDAS, não o que viraria fila: a varredura ainda recusa"
    + "\n  cancelada, sem valor, sem emitente e substituída — e nota que já virou declarado volta como"
    + "\n  `jaExistiam`, sem nada ser tocado.",
  );
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
