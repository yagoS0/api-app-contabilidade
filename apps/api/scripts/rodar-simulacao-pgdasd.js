// Roda a SIMULAÇÃO PGDAS-D (indicadorTransmissao:false) em PRODUÇÃO, com os dados
// reais do fechamento de uma empresa. NÃO transmite — só calcula e devolve o DAS.
// Uso: node apps/api/scripts/rodar-simulacao-pgdasd.js <portalClientId> <YYYY-MM>
import { prisma } from "../src/infrastructure/db/prisma.js";
import { getDadosFechamento } from "../src/application/notas/apuracao/v2/FechamentoService.js";
import { getResolvedSerproCredentials } from "../src/application/fiscal/serpro/SerproRuntimeSettings.js";
import { PgdasSimulacaoService } from "../src/application/fiscal/serpro/PgdasSimulacaoService.js";

const [portalClientId, competencia] = process.argv.slice(2);
if (!portalClientId || !competencia) { console.error("uso: <portalClientId> <YYYY-MM>"); process.exit(1); }

function paList(comp, n = 12) {
  const [y, m] = comp.split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`); }
  return out;
}

(async () => {
  const dados = await getDadosFechamento({ portalClientId, competencia });
  const atividades = (dados.atividades || []).filter((a) => a && a.idAtividade != null);
  console.log(`Empresa: ${dados.razao} (${dados.cnpj}) · ${competencia}`);
  console.log(`Atividades:`, atividades.map((a) => `#${a.idAtividade} int=${a.valorInterno} ext=${a.valorExterno}`).join(" | "));
  console.log(`RBT12 (cache): ${dados.rbt12} (${dados.rbt12Origem})`);

  const cache = await prisma.rbtExtratoCache.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  }).catch(() => null);
  const rba = Array.isArray(cache?.detalhePorMes) && cache.detalhePorMes.length
    ? cache.detalhePorMes
    : paList(competencia).map((pa) => ({ pa, valorInterno: 0, valorExterno: 0 }));

  // Folha: usa a da memória se houver; senão 0 (sem Fator-R real informado ainda)
  const folha = Array.isArray(dados.folhaMensal12) && dados.folhaMensal12.length
    ? dados.folhaMensal12
    : paList(competencia).map((pa) => ({ pa, valor: 0 }));

  const creds = await getResolvedSerproCredentials();
  const contratanteCnpj = String(creds.certificate.document || "").replace(/\D+/g, "");

  console.log(`\nChamando SIMULAÇÃO (indicadorTransmissao:false) em PRODUÇÃO...`);
  const sim = new PgdasSimulacaoService();
  const r = await sim.simular({
    contratanteCnpj,
    contribuinteCnpj: dados.cnpj,
    competencia,
    regimeApuracao: dados.regimeApuracao,
    atividades,
    receitasBrutasAnteriores: rba,
    folhasSalario: folha,
  });

  console.log(`\n=== RESULTADO DA SIMULAÇÃO ===`);
  console.log("DAS calculado:", r.dasValor);
  console.log("Tributos:", JSON.stringify(r.tributos, null, 2));
  console.log("numeroDeclaracao:", r.numeroDeclaracao);
  console.log("mensagens:", JSON.stringify(r.mensagens, null, 2));
  console.log("\n=== RETORNO BRUTO (pra calibrar o parse) ===");
  console.log(JSON.stringify(r.raw, null, 2)?.slice(0, 3000));
})().catch((err) => { console.error("ERRO:", err?.code, err?.message); console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
