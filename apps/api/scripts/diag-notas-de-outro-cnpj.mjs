// Encontra notas gravadas na EMPRESA ERRADA — SOMENTE LEITURA, não apaga nada.
//
// POR QUE EXISTE
// O ADN Contribuinte identifica o contribuinte pelo CERTIFICADO, não por parâmetro: o path é
// `/DFe/{NSU}` e não carrega CNPJ. A captura tinha um fallback para o cert do ESCRITÓRIO quando a
// empresa não tinha A1, supondo que daria 404. Não dava: o escritório é cadastrado no gov.br/nfse,
// então o ADN devolvia as notas DELE — e elas eram gravadas debaixo da empresa cliente, como DEST
// (o CNPJ não bate, então caíam em "recebidas").
//
// O fallback foi removido e a ingestão passou a recusar documento de outro CNPJ. Isto aqui é para
// achar o que JÁ ENTROU antes disso.
//
// Uso:
//   node scripts/diag-notas-de-outro-cnpj.mjs              # a carteira toda
//   node scripts/diag-notas-de-outro-cnpj.mjs 66233216000105   # uma empresa
//
// Não remove nada de propósito: apagar nota fiscal é irreversível e a decisão é do contador. A
// saída traz os ids para uma limpeza dirigida, depois de conferida.

import { prisma } from "../src/infrastructure/db/prisma.js";

const so = (v) => String(v || "").replace(/\D+/g, "");
const brl = (n) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const filtroCnpj = so(process.argv[2]);

const empresas = await prisma.portalClient.findMany({
  where: filtroCnpj ? { cnpj: { contains: filtroCnpj } } : {},
  select: { id: true, razao: true, cnpj: true },
  orderBy: { razao: "asc" },
});
if (!empresas.length) { console.log("nenhuma empresa encontrada"); await prisma.$disconnect(); process.exit(0); }

let totalSuspeitas = 0;
let totalEmit = 0;
const porOrigem = new Map();

for (const emp of empresas) {
  const cnpjEmpresa = so(emp.cnpj);
  if (cnpjEmpresa.length !== 14) {
    console.log(`⚠ ${emp.razao}: CNPJ inválido (${emp.cnpj}) — não dá para conferir`);
    continue;
  }

  const notas = await prisma.portalInvoice.findMany({
    where: { clientId: emp.id },
    select: {
      id: true, type: true, numero: true, chaveAcesso: true, papel: true, competencia: true,
      total: true, emitenteDoc: true, emitenteNome: true, tomadorDoc: true, tomadorNome: true,
      statusEfetivo: true,
    },
    orderBy: { competencia: "asc" },
  });

  // Suspeita = a empresa não é nem prestadora nem tomadora. Nota sem NENHUM dos dois documentos
  // não entra na lista: ausência de dado não é evidência de nota alheia.
  const suspeitas = notas.filter((n) => {
    const e = so(n.emitenteDoc);
    const t = so(n.tomadorDoc);
    if (!e && !t) return false;
    return e !== cnpjEmpresa && t !== cnpjEmpresa;
  });
  if (!suspeitas.length) continue;

  totalSuspeitas += suspeitas.length;
  console.log(`\n${emp.razao}  (${emp.cnpj})  —  ${suspeitas.length} de ${notas.length} nota(s) suspeitas`);
  for (const n of suspeitas) {
    const marca = n.papel === "EMIT" ? "  ⚠⚠ EMIT (entra no FATURAMENTO e na apuração)" : "";
    if (n.papel === "EMIT") totalEmit += 1;
    const origem = `${so(n.emitenteDoc) || "?"} ${n.emitenteNome || ""}`.trim();
    porOrigem.set(origem, (porOrigem.get(origem) || 0) + 1);
    const comp = n.competencia ? new Date(n.competencia).toISOString().slice(0, 7) : "—";
    console.log(`   [${n.papel || "?"}] ${comp}  nº ${n.numero || "—"}  ${brl(n.total)}  ${n.statusEfetivo || ""}${marca}`);
    console.log(`        de ${so(n.emitenteDoc) || "?"} (${n.emitenteNome || "—"})  →  para ${so(n.tomadorDoc) || "?"} (${n.tomadorNome || "—"})`);
    console.log(`        id ${n.id}${n.chaveAcesso ? `  chave ${n.chaveAcesso}` : ""}`);
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log(`TOTAL DE NOTAS SUSPEITAS: ${totalSuspeitas}`);
if (totalEmit) {
  console.log(`⚠ ${totalEmit} delas estão como EMIT — essas entram no faturamento e podem ter afetado apuração/DAS.`);
} else if (totalSuspeitas) {
  console.log("Nenhuma como EMIT: o faturamento (que usa EMIT autorizada) não foi afetado.");
}
if (porOrigem.size) {
  console.log("\nDE QUEM SÃO ESSAS NOTAS (top 10):");
  for (const [origem, n] of [...porOrigem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(5)}  ${origem}`);
  }
}
if (!totalSuspeitas) console.log("Nada a corrigir.");
else console.log("\nNada foi apagado. Confira a lista antes de qualquer remoção — nota fiscal não volta.");

await prisma.$disconnect();
