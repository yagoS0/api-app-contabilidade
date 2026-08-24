// SOMENTE LEITURA. "O endereco do prestador sai preenchido no DANFSe, em nota REAL?"
// Nao imprime valor nenhum -- so se o campo saiu preenchido, e o motivo quando nao saiu.
import { PrismaClient } from "@prisma/client";
import { lerNfse } from "../src/application/nfse/danfse/danfseDados.js";

const prisma = new PrismaClient();
const N = Number(process.argv[2] || 300);

const notas = await prisma.portalInvoice.findMany({
  where: { type: "NFSE", papel: "EMIT", xmlRaw: { not: null } },
  select: { id: true, xmlRaw: true },
  orderBy: { createdAt: "desc" },
  take: N,
});

let ok = 0, semEndereco = 0, semNome = 0, ilegivel = 0;
const motivos = new Map();

for (const n of notas) {
  let v, avisos;
  try { ({ valores: v, avisos } = lerNfse(n.xmlRaw)); } catch { ilegivel++; continue; }
  const temEnd = Boolean(v.prestEndereco);
  const temNome = Boolean(v.prestNome);
  if (temEnd && temNome) { ok++; continue; }
  if (!temEnd) semEndereco++;
  if (!temNome) semNome++;
  const motivo = (avisos.find((a) => /prestador/i.test(a)) || "(sem aviso sobre o prestador)").slice(0, 120);
  motivos.set(motivo, (motivos.get(motivo) || 0) + 1);
}

console.log(`\nNotas EMIT com xmlRaw analisadas: ${notas.length}\n`);
console.log(`  nome E endereco PREENCHIDOS ... ${ok}`);
console.log(`  sem ENDERECO .................. ${semEndereco}`);
console.log(`  sem NOME ...................... ${semNome}`);
console.log(`  XML ilegivel .................. ${ilegivel}`);
if (motivos.size) {
  console.log(`\n--- por que ficou vazio`);
  for (const [m, c] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}x  ${m}`);
}
console.log("");
await prisma.$disconnect();
