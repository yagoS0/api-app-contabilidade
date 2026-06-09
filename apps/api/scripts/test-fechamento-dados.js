// Testa getDadosFechamento (montagem do modal — sem chamar SERPRO).
// Uso: node apps/api/scripts/test-fechamento-dados.js <portalClientId> <YYYY-MM>
import { prisma } from "../src/infrastructure/db/prisma.js";
import { getDadosFechamento } from "../src/application/notas/apuracao/v2/FechamentoService.js";

const [portalClientId, competencia] = process.argv.slice(2);
if (!portalClientId || !competencia) { console.error("uso: <portalClientId> <YYYY-MM>"); process.exit(1); }

(async () => {
  const dados = await getDadosFechamento({ portalClientId, competencia });
  // resumo legível
  console.log("razao:", dados.razao);
  console.log("estado:", dados.estado, "| cadastroCompleto:", dados.cadastroCompleto, "| regime:", dados.regimeApuracao);
  console.log("faturamento:", JSON.stringify(dados.faturamento));
  console.log("rbt12:", dados.rbt12, "(", dados.rbt12Origem, ")");
  console.log("origemAtividades:", dados.origemAtividades);
  console.log("atividades:");
  for (const a of dados.atividades || []) {
    if (!a || a.idAtividade == null) continue;
    console.log(`  #${a.idAtividade} ${a.descricao} | anexo ${a.anexoImplicito}${a.sujeitoFatorR ? " ★FR" : ""} | int ${a.valorInterno} ext ${a.valorExterno}`);
  }
  console.log("disparidades:", JSON.stringify(dados.disparidades));
  console.log("semClassificacao:", dados.semClassificacao);
})().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
