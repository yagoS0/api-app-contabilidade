/**
 * ⚠⚠ LIGA A VARREDURA AUTOMÁTICA DE NOTAS E VARRE NA HORA — ESTE SCRIPT **ESCREVE**.
 *
 * > Dono, 01/09/2026: *"as notas devem ser trazidas automaticamente"*.
 *
 * ⚠⚠ A DATA-PISO É OBRIGATÓRIA e vem por ARGUMENTO, nunca por default. Sem piso a primeira
 * varredura despeja a base inteira na fila, e um piso escolhido pelo SISTEMA faria o sistema decidir
 * o tamanho do trabalho que o contador vai encontrar na tela. É a mesma recusa da rota
 * (`data_piso_obrigatoria`), e ela vale igual aqui.
 *
 * ⚠ O caminho normal é a TELA (Conferência → «Trazer notas», com a caixa marcada). Este script
 * existe para ligar em lote, quando a decisão já foi tomada.
 *
 * ⚠ O que ele cria são DECLARADOS em `AGUARDANDO_PAGAMENTO` — fila de conferência. **Nenhum
 * lançamento contábil nasce daqui**: quem contabiliza continua sendo o contador.
 * ⚠ Idempotente: nota que já virou declarado volta como `jaExistiam`, sem nada ser tocado.
 *
 *   node scripts/ligar-varredura-automatica.mjs AAAA-MM-DD [--empresa <id|trecho da razão>]
 *   node scripts/ligar-varredura-automatica.mjs 2026-05-01 --empresa LENTE
 */
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  ligarVarreduraAutomatica,
  varrerEmpresasComVarreduraAutomatica,
} from "../src/application/declarados/VarreduraDeNotasService.js";

const args = process.argv.slice(2);
const piso = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const i = args.indexOf("--empresa");
const alvo = i >= 0 ? args[i + 1] : null;

if (!piso) {
  console.error(
    "⚠ Informe a data-piso: node scripts/ligar-varredura-automatica.mjs AAAA-MM-DD [--empresa <id|razão>]\n"
    + "  Ela NÃO tem default de propósito — sem corte, toda a base de notas recebidas entraria de uma vez.",
  );
  process.exit(1);
}

async function main() {
  const empresas = await prisma.portalClient.findMany({
    where: alvo
      ? { OR: [{ id: alvo }, { razao: { contains: alvo, mode: "insensitive" } }] }
      : {},
    select: { id: true, razao: true },
    orderBy: { razao: "asc" },
  });

  if (!empresas.length) {
    console.error(`⚠ Nenhuma empresa casa com "${alvo}". Nada foi ligado.`);
    process.exit(1);
  }

  console.log(`\nLIGANDO a varredura automática desde ${piso} em ${empresas.length} empresa(s):\n`);
  for (const e of empresas) {
    // eslint-disable-next-line no-await-in-loop
    await ligarVarreduraAutomatica({
      portalClientId: e.id,
      dataPiso: new Date(`${piso}T00:00:00.000Z`),
      // ⚠ Quem ligou foi uma pessoa, por fora da tela — e a auditoria diz isso em vez de fingir que
      // foi o sistema. Ver `criadoPor: "sistema:varredura_automatica"` no serviço, que é outra coisa.
      usuarioId: "script:ligar-varredura-automatica",
    });
    console.log(`  ligada: ${e.razao || e.id}`);
  }

  console.log("\nVARRENDO agora (o mesmo que o worker faz a cada ciclo de captura)…\n");
  const r = await varrerEmpresasComVarreduraAutomatica();
  for (const e of r.empresas) {
    const nome = empresas.find((x) => x.id === e.portalClientId)?.razao || e.portalClientId;
    console.log(`  ${nome}: ${e.criados} nota(s) entraram na fila${e.erro ? ` · ⚠ ${e.erro}` : ""}`);
  }
  console.log(`\n✓ ${r.varridas} empresa(s) varrida(s).`);
  console.log("⚠ A fila é da Conferência; nenhum lançamento contábil foi criado.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
