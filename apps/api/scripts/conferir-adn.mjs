// Ferramenta de conferência (Camada 2) — rode EM PRODUÇÃO, no ambiente do escritório (tem cert + ADN).
// Confere a contagem de NFS-e de uma competência contra o ADN e mostra as chaves que faltam no nosso
// lado (o "28 vs 27"). Grava o resultado no snapshot (se existir) → salvarFechamento trava se divergente.
//   node scripts/conferir-adn.mjs --portalClientId=<id> --competencia=YYYY-MM [--env=prod]
// Nada é enviado pra fora: roda contra o seu banco + seu cert.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { conferirCompetencia } from "../src/application/notas/apuracao/v2/ConferenciaAdnService.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const portalClientId = arg("portalClientId");
const competencia = arg("competencia");
const env = arg("env") || "prod";

if (!portalClientId || !competencia) {
  console.error("Uso: node scripts/conferir-adn.mjs --portalClientId=<id> --competencia=YYYY-MM [--env=prod]");
  process.exit(2);
}

try {
  const out = await conferirCompetencia({ portalClientId, competencia, env });
  const r = out.resultado || {};
  console.log(`status: ${out.status}  (persistido no snapshot: ${out.persistido})`);
  if (out.status === "divergente") {
    console.log(`\n⚠ DIVERGÊNCIA — ADN ${r.adnTotal} × nós ${r.nossoTotal}. Faltam ${r.faltantes.length} chave(s):`);
    for (const c of r.faltantes) console.log("  " + c);
    if (r.extras?.length) console.log(`\n(${r.extras.length} chave(s) que nós temos e o ADN não devolveu — geralmente notas antigas/pré-ADN.)`);
  } else if (out.status === "ok") {
    console.log(`\n✅ OK — ${r.adnTotal} nota(s) conferem (nós ${r.nossoTotal}).`);
  } else {
    console.log(`\nℹ Não conferível: ${r.motivo}. (Município fora do ADN ou empresa sem cert próprio — não trava o fechamento.)`);
  }
} catch (err) {
  console.error("Erro na conferência:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
