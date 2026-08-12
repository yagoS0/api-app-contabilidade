// A MESMA NOTA GRAVADA DUAS VEZES — SOMENTE LEITURA, não apaga e não corrige nada.
//
// POR QUE EXISTE
// A captura (ADN) e o import manual de XML tinham DUAS implementações da mesma ingestão, e elas
// discordavam na chave de deduplicação:
//   • captura: grava `chaveAcesso` quando o XML tem chave e deixa `idNfse` NULO (de propósito —
//     `idNfse` só é escrito no fallback sem-chave, para não colidir com nota DEST de mesmo número
//     emitida por outro prestador);
//   • import:  gravava `chaveAcesso: null` FIXO e `idNfse = numeroNfse`, e dava upsert por
//     `clientId_idNfse` — que nunca encontrava a linha da captura.
// Resultado: duas linhas para a mesma nota, as duas `papel:"EMIT"` e `statusEfetivo:"autorizada"`.
// O faturamento soma a nota DUAS VEZES, e a conferência do ADN (`ConferenciaAdnService.
// getNossoConjunto`, que monta o conjunto com `chaveAcesso || idNfse`) compara NÚMERO contra CHAVE,
// acusa `divergente` que não existe e TRAVA o `salvarFechamento`.
//
// O código já foi consertado (ingestão única em `src/application/notas/ingestaoNfse.js`). Isto aqui
// mede o que JÁ ENTROU antes disso.
//
// ⚠ ELE NÃO APAGA NADA, E ISSO É DELIBERADO. Nota fiscal não volta atrás, e decidir o que fazer com
// as duplicatas existentes (apagar qual das duas, retificar apuração, refazer conferência) é do
// DONO, que é contador — não deste script e não de quem o roda.
//
// ⚠ NÃO CHAMA ADN, SEFAZ NEM SERPRO. Nenhuma chamada externa, nenhum custo, nenhuma escrita.
//
// Uso (local, com DATABASE_URL apontando para onde se quer olhar):
//   node apps/api/scripts/diag-notas-duplicadas.mjs
//   node apps/api/scripts/diag-notas-duplicadas.mjs 66233216000105   # uma empresa
//
// Em produção (Railway) — ⚠ `railway run … bash -c` NÃO funciona nesta máquina (WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-notas-duplicadas.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const so = (v) => String(v || "").replace(/\D+/g, "");
const brl = (n) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const num = (v) => Number(v?.toString?.() ?? v ?? 0);
const comp = (d) => (d ? new Date(d).toISOString().slice(0, 7) : "—");

const filtroCnpj = so(process.argv[2]);

const empresas = await prisma.portalClient.findMany({
  where: filtroCnpj ? { cnpj: { contains: filtroCnpj } } : {},
  select: { id: true, razao: true, cnpj: true },
  orderBy: { razao: "asc" },
});
if (!empresas.length) {
  console.log("nenhuma empresa encontrada");
  await prisma.$disconnect();
  process.exit(0);
}

let totalPares = 0;
let totalDuplicadoGeral = 0;
const competenciasSuspeitas = [];

for (const emp of empresas) {
  // Só NFS-e: a NF-e (SEFAZ) sempre teve chave nos dois caminhos e não tem import manual.
  const notas = await prisma.portalInvoice.findMany({
    where: { clientId: emp.id, type: "NFSE" },
    select: {
      id: true, numero: true, chaveAcesso: true, idNfse: true, competencia: true, total: true,
      papel: true, statusEfetivo: true, emitenteDoc: true, createdAt: true,
    },
    orderBy: { competencia: "asc" },
  });
  if (!notas.length) continue;

  // ── (1) Candidatas a duplicata ────────────────────────────────────────────────────────────────
  // Mesma competência + mesmo `numero` + mesmo `total`, UMA com chave e OUTRA sem (só `idNfse`).
  // É a assinatura exata do defeito: as duas linhas vêm do mesmo XML, uma por cada caminho.
  // Não basta "mesmo número": prestadores diferentes repetem numeração, por isso o total e a
  // competência entram na chave — e o par tem de ter uma linha de cada TIPO de identificador.
  const grupos = new Map();
  for (const n of notas) {
    if (!n.numero) continue;
    const chave = `${comp(n.competencia)}|${n.numero}|${num(n.total).toFixed(2)}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(n);
  }

  const pares = [];
  for (const [chave, linhas] of grupos.entries()) {
    if (linhas.length < 2) continue;
    const comChave = linhas.filter((n) => n.chaveAcesso);
    const semChave = linhas.filter((n) => !n.chaveAcesso && n.idNfse);
    if (!comChave.length || !semChave.length) continue;
    pares.push({ chave, comChave, semChave, linhas });
  }
  if (!pares.length) continue;

  totalPares += pares.length;
  console.log(`\n${"─".repeat(78)}`);
  console.log(`${emp.razao}  (${emp.cnpj})  —  ${pares.length} nota(s) com linha duplicada`);

  // ── (2) Faturamento DUPLICADO por competência ─────────────────────────────────────────────────
  // Só conta o excedente, e só do que entra no faturamento: `papel:"EMIT"` + `autorizada` — a mesma
  // população que `FechamentoService` soma. Linha cancelada ou DEST não infla receita.
  const duplicadoPorComp = new Map();
  for (const p of pares) {
    const [competencia] = p.chave.split("|");
    console.log(`\n  competência ${competencia} · nº ${p.linhas[0].numero} · ${brl(p.linhas[0].total)}`);
    for (const n of p.linhas) {
      const marca = n.chaveAcesso ? "CHAVE " : "NÚMERO";
      const conta = n.papel === "EMIT" && n.statusEfetivo === "autorizada" ? " ← soma no faturamento" : "";
      console.log(
        `    [${marca}] ${n.papel || "?"}/${n.statusEfetivo || "?"}  criada ${new Date(n.createdAt).toISOString().slice(0, 10)}`
        + `  id ${n.id}${conta}`,
      );
      console.log(`             ${n.chaveAcesso ? `chave ${n.chaveAcesso}` : `idNfse ${n.idNfse}`}`);
    }
    const contando = p.linhas.filter((n) => n.papel === "EMIT" && n.statusEfetivo === "autorizada");
    if (contando.length > 1) {
      // O excedente = (n-1) × valor. Duas linhas da mesma nota dobram; três triplicam.
      const excedente = num(p.linhas[0].total) * (contando.length - 1);
      duplicadoPorComp.set(competencia, (duplicadoPorComp.get(competencia) || 0) + excedente);
    }
  }

  if (duplicadoPorComp.size) {
    console.log("\n  FATURAMENTO DUPLICADO (excedente, EMIT autorizada):");
    for (const [competencia, valor] of [...duplicadoPorComp.entries()].sort()) {
      console.log(`    ${competencia}  +${brl(valor)}`);
      totalDuplicadoGeral += valor;
    }
  } else {
    console.log("\n  Nenhuma das linhas duplicadas soma no faturamento (nenhuma EMIT autorizada em par).");
  }

  // ── (3) Divergência FALSA de conferência ──────────────────────────────────────────────────────
  // `getNossoConjunto` usa `chaveAcesso || idNfse`. A linha importada entra pelo NÚMERO, o ADN
  // responde com CHAVES: a nota presente é contada como faltante e `salvarFechamento` trava com
  // `DIVERGENCIA_CONFERENCIA`. Aqui listamos as competências que têm as DUAS coisas ao mesmo tempo:
  // status `divergente` gravado E nota entrando pelo número. É candidata, não veredito — só a
  // reconferência contra o ADN (fora deste script) decide.
  const snapshots = await prisma.apuracaoSnapshot.findMany({
    where: { portalClientId: emp.id, conferenciaStatus: "divergente" },
    select: { competencia: true, conferenciaResultado: true, conferidaEm: true },
  });
  if (snapshots.length) {
    const compsComNotaPorNumero = new Set(
      notas
        .filter((n) => !n.chaveAcesso && n.idNfse && n.papel === "EMIT" && n.statusEfetivo === "autorizada")
        .map((n) => comp(n.competencia)),
    );
    const suspeitas = snapshots.filter((s) => compsComNotaPorNumero.has(s.competencia));
    if (suspeitas.length) {
      console.log("\n  ⚠ CONFERÊNCIA `divergente` COM NOTA ENTRANDO PELO NÚMERO (divergência possivelmente FALSA):");
      for (const s of suspeitas) {
        const faltantes = Array.isArray(s.conferenciaResultado?.faltantes)
          ? s.conferenciaResultado.faltantes.length
          : "?";
        competenciasSuspeitas.push(`${emp.razao} ${s.competencia}`);
        console.log(
          `    ${s.competencia}  faltantes segundo a conferência: ${faltantes}`
          + `  conferida em ${s.conferidaEm ? new Date(s.conferidaEm).toISOString().slice(0, 10) : "—"}`,
        );
      }
      console.log("    → o fechamento destas competências está TRAVADO por DIVERGENCIA_CONFERENCIA.");
    }
  }
}

// ── (4) Linha de base da classificação ──────────────────────────────────────────────────────────
// Medida ANTES da classificação retroativa, para se saber depois o que ela mudou — e para provar
// que a recaptura não desfez o trabalho.
const escopoItens = filtroCnpj
  ? { nota: { client: { cnpj: { contains: filtroCnpj } } } }
  : {};
const [itensTotal, itensClassificados, itensComAnexo] = await Promise.all([
  prisma.notaItem.count({ where: escopoItens }),
  prisma.notaItem.count({ where: { ...escopoItens, NOT: { tipoReceita: null } } }),
  prisma.notaItem.count({ where: { ...escopoItens, NOT: { anexoResolvido: null } } }),
]);

console.log(`\n${"=".repeat(78)}`);
console.log(`NOTAS COM LINHA DUPLICADA: ${totalPares}`);
if (totalDuplicadoGeral) {
  console.log(`FATURAMENTO CONTADO A MAIS (soma de todas as competências): ${brl(totalDuplicadoGeral)}`);
} else if (totalPares) {
  console.log("Nenhuma duplicata soma no faturamento.");
}
if (competenciasSuspeitas.length) {
  console.log(`\nCOMPETÊNCIAS COM DIVERGÊNCIA POSSIVELMENTE FALSA: ${competenciasSuspeitas.length}`);
  for (const c of competenciasSuspeitas) console.log(`  ${c}`);
}

console.log("\nLINHA DE BASE DA CLASSIFICAÇÃO (antes da retroativa):");
const pct = itensTotal ? ((itensClassificados / itensTotal) * 100).toFixed(1) : "0.0";
console.log(`  itens de nota no escopo:        ${itensTotal}`);
console.log(`  com \`tipoReceita\` preenchido:   ${itensClassificados}  (${pct}%)`);
console.log(`  com \`anexoResolvido\` (legado):  ${itensComAnexo}`);

if (!totalPares) console.log("\nNenhuma duplicata encontrada.");
console.log("\nNada foi apagado nem corrigido. A decisão sobre as duplicatas é do dono — nota fiscal não volta.");

await prisma.$disconnect();
