// QUAIS VALORES DE REGIME EXISTEM DE FATO — a medição que decide o despacho da aba Apuração.
//
// A aba "Apuração" é escondida por `isSimplesCompany` (`renderCompanyDetailHeader.jsx`), que compara
// **`=== "SIMPLES"` exato** e devolve `true` (mostra a do Simples) quando não há regime. Ao abrir a
// aba para o Lucro Presumido, o mesmo campo passa a decidir QUAL das duas telas renderiza — e um
// valor fora do esperado deixaria de esconder uma aba para passar a mostrar a tela ERRADA.
//
// ⚠ SÓ LEITURA. Zero escrita, zero chamada externa (ADN/SEFAZ/SERPRO).
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-regime-para-aba-lp.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const linha = (a, b, n) => `  ${String(a).padEnd(24)} | ${String(b).padEnd(22)} ${String(n).padStart(5)}`;

async function main() {
  console.log("\n═══ REGIME DAS EMPRESAS — o que a aba Apuração vai ler ═══");

  const porCompany = await prisma.$queryRaw`
    SELECT COALESCE(c."regimeTributario", '(NULO)') AS regime, COUNT(*)::int AS n
    FROM "Company" c GROUP BY 1 ORDER BY 2 DESC`;
  console.log("\nCompany.regimeTributario — a fonte que a TELA lê hoje:");
  for (const r of porCompany) console.log(`  ${String(r.regime).padEnd(28)} ${r.n}`);

  const porCadastro = await prisma.$queryRaw`
    SELECT COALESCE(cf."regime", '(NULO)') AS regime, COUNT(*)::int AS n
    FROM "cadastros_fiscais" cf GROUP BY 1 ORDER BY 2 DESC`;
  console.log("\ncadastros_fiscais.regime — a fonte que o BACKEND trata como autoridade:");
  for (const r of porCadastro) console.log(`  ${String(r.regime).padEnd(28)} ${r.n}`);

  // ⚠ É o CRUZAMENTO que responde a pergunta que interessa: as duas fontes concordam?
  // Discordando, a tela mostraria uma aba e a rota calcularia a outra coisa.
  const cruz = await prisma.$queryRaw`
    SELECT COALESCE(c."regimeTributario",'(NULO)')  AS company_regime,
           COALESCE(cf."regime",'(SEM CADASTRO)')   AS cadastro_regime,
           COUNT(*)::int AS n
    FROM "PortalClient" p
    LEFT JOIN "Company" c ON c."id" = p."companyId"
    LEFT JOIN "cadastros_fiscais" cf ON cf."portalClientId" = p."id"
    GROUP BY 1,2 ORDER BY 3 DESC`;
  console.log("\nPortalClient × as duas fontes:");
  console.log(linha("Company", "CadastroFiscal", "n"));
  for (const r of cruz) console.log(linha(r.company_regime, r.cadastro_regime, r.n));

  // ⚠ O que a tela faria com cada valor, HOJE — antes de qualquer mudança.
  console.log("\nO que `isSimplesCompany` responde para cada valor de Company.regimeTributario:");
  for (const r of porCompany) {
    const v = r.regime === "(NULO)" ? null : r.regime;
    const simples = !v || String(v).trim().toUpperCase() === "SIMPLES";
    console.log(`  ${String(r.regime).padEnd(28)} ${simples ? "→ aba do SIMPLES" : "→ aba ESCONDIDA hoje"}  (${r.n})`);
  }

  console.log("");
}

main()
  .catch((e) => { console.error("\n⚠ falhou:", e?.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
