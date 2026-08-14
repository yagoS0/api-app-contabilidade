// MEDE ANTES DA MIGRATION `20260814120000_add_nfse_emissao_fase1`. SÓ LEITURA.
//
// Zero chamada externa, zero escrita. Responde as três perguntas que a migration faz ao banco:
//
//   1. existe alguma `ServiceInvoice` que VIOLARIA o índice único
//      `(companyId, rpsSerie, rpsNumero)`? (se houver, o `CREATE UNIQUE INDEX` falha)
//   2. quantas empresas têm `codigoMunicipioIbge` a preencher, e o que existe hoje em
//      `PortalClient.municipio`/`uf` — que é a única fonte de município do projeto, e é TEXTO;
//   3. como está a série (`rpsSerie`) de cada empresa perante a faixa `00001–49999` da RN E0010.
//
// ⚠ A pergunta 2 NÃO é resolvida por este script, e ele não tenta: o de-para nome→IBGE exige a
// tabela de municípios do IBGE, que o projeto não tem. Ele mostra o tamanho do problema para o
// dono decidir; converter por semelhança de nome erraria em homônimo, em silêncio.
//
// Uso:  node apps/api/scripts/diag-nfse-numeracao.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function linha(...cols) {
  console.log(cols.join("  "));
}

async function main() {
  // ── 1. Duplicatas que impediriam o índice único ──────────────────────────────────────────
  const duplicadas = await prisma.$queryRawUnsafe(`
    SELECT "companyId", "rpsSerie", "rpsNumero", COUNT(*)::int AS n
      FROM "ServiceInvoice"
     WHERE "rpsSerie" IS NOT NULL AND "rpsNumero" IS NOT NULL
     GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
     ORDER BY n DESC
  `);
  console.log("\n=== 1. (companyId, rpsSerie, rpsNumero) DUPLICADOS ===");
  if (!duplicadas.length) {
    console.log("nenhum — o CREATE UNIQUE INDEX passa.");
  } else {
    console.log(`⚠ ${duplicadas.length} conjunto(s) duplicado(s). O índice único VAI FALHAR.`);
    for (const d of duplicadas) linha(d.companyId, `serie=${d.rpsSerie}`, `n=${d.rpsNumero}`, `x${d.n}`);
  }

  const total = await prisma.serviceInvoice.count();
  const porStatus = await prisma.serviceInvoice.groupBy({ by: ["status"], _count: { _all: true } });
  console.log(`\ntotal de ServiceInvoice: ${total}`);
  for (const s of porStatus) linha(` ${s.status}:`, String(s._count._all));

  // ── 2. Município emissor ────────────────────────────────────────────────────────────────
  console.log("\n=== 2. cLocEmi — codigoMunicipioIbge x PortalClient.municipio (TEXTO) ===");
  const companies = await prisma.company.findMany({
    select: { id: true, cnpj: true, razaoSocial: true, rpsSerie: true, rpsNumero: true },
    orderBy: { razaoSocial: "asc" },
  });
  const portais = await prisma.portalClient.findMany({
    where: { companyId: { not: null } },
    select: { companyId: true, municipio: true, uf: true },
  });
  const porCompany = new Map(portais.map((p) => [p.companyId, p]));

  // A coluna nova pode ainda não existir (migration não aplicada) — leitura tolerante.
  let ibgePorCompany = new Map();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "codigoMunicipioIbge" FROM "Company" WHERE "codigoMunicipioIbge" IS NOT NULL`
    );
    ibgePorCompany = new Map(rows.map((r) => [r.id, r.codigoMunicipioIbge]));
  } catch {
    console.log("(coluna codigoMunicipioIbge ainda não existe — migration não aplicada)");
  }

  let semMunicipio = 0;
  let semTextoTambem = 0;
  const porTexto = new Map();
  for (const c of companies) {
    const ibge = ibgePorCompany.get(c.id) || null;
    const p = porCompany.get(c.id);
    const texto = p?.municipio ? `${p.municipio}/${p.uf || "??"}` : null;
    if (!ibge) {
      semMunicipio += 1;
      if (!texto) semTextoTambem += 1;
      else porTexto.set(texto, (porTexto.get(texto) || 0) + 1);
    }
  }
  console.log(`empresas sem codigoMunicipioIbge: ${semMunicipio} de ${companies.length}`);
  console.log(`  destas, sem NEM o texto em PortalClient.municipio: ${semTextoTambem}`);
  console.log("  distribuição do texto disponível (fonte única, e não é código):");
  for (const [t, n] of [...porTexto.entries()].sort((a, b) => b[1] - a[1])) linha(`   ${t}:`, String(n));

  // ── 3. Série perante a RN E0010 ─────────────────────────────────────────────────────────
  console.log("\n=== 3. rpsSerie x faixa 00001–49999 (RN E0010, aplicativo próprio) ===");
  const problemas = [];
  for (const c of companies) {
    const bruta = String(c.rpsSerie ?? "").trim();
    let veredito = null;
    if (!bruta) veredito = "SEM SÉRIE";
    else if (!/^\d+$/.test(bruta)) veredito = "NÃO NUMÉRICA";
    else if (Number(bruta) < 1 || Number(bruta) > 49999) veredito = "FORA DA FAIXA";
    if (veredito) problemas.push({ c, bruta, veredito });
  }
  if (!problemas.length) console.log("todas as séries cadastradas estão na faixa.");
  for (const p of problemas) {
    linha(` ${p.veredito}:`, p.c.cnpj, `"${p.bruta}"`, p.c.razaoSocial);
  }

  const semContador = companies.filter((c) => !String(c.rpsNumero ?? "").trim()).length;
  console.log(`\nempresas com rpsNumero NULO/vazio (contador zerado): ${semContador} de ${companies.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
