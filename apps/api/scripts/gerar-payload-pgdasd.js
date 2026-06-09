// Q15 — Gera o payload TRANSDECLARACAO11 que o buildDeclaracaoPayload produz,
// pronto pra colar no curl do trial (pergunta 2) e variar idAtividade (pergunta 1B).
//
// NÃO chama o SERPRO. Só monta e imprime o JSON.
//
// Uso:
//   # a partir de uma empresa real (usa atividades/faturamento das notas):
//   node apps/api/scripts/gerar-payload-pgdasd.js <portalClientId> <YYYY-MM>
//
//   # modo trial (CNPJ fictício + dados de exemplo, sem tocar no banco de notas):
//   node apps/api/scripts/gerar-payload-pgdasd.js --trial
//
// Saída: (1) objeto declaracao (legível) e (2) corpo curl completo com o `dados`
// já escapado como string JSON-dentro-de-JSON (quirk do Integra Contador).

import { prisma } from "../src/infrastructure/db/prisma.js";
import { buildDeclaracaoPayload } from "../src/application/fiscal/serpro/PgdasSimulacaoService.js";
import { getDadosFechamento } from "../src/application/notas/apuracao/v2/FechamentoService.js";

const TRIAL_BASE = "https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Declarar";
const TRIAL_CNPJ = "00000000000100";

function pasAnteriores(competencia, n = 12) {
  const [y, m] = String(competencia).split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function imprimir({ cnpj, competencia, declaracao }) {
  const dadosStr = JSON.stringify(declaracao);
  const envelope = {
    contratante: { numero: cnpj, tipo: 2 },
    autorPedidoDados: { numero: cnpj, tipo: 2 },
    contribuinte: { numero: cnpj, tipo: 2 },
    pedidoDados: {
      idSistema: "PGDASD",
      idServico: "TRANSDECLARACAO11",
      versaoSistema: "1.0",
      dados: dadosStr,
    },
  };
  console.log("\n=== (1) objeto declaracao (legível) ===");
  console.log(JSON.stringify(declaracao, null, 2));
  console.log("\n=== (2) corpo curl (cole após -d, ajuste o token) ===");
  console.log(`curl -X POST '${TRIAL_BASE}' \\`);
  console.log(`  -H 'Authorization: Bearer SEU_TOKEN_TRIAL' \\`);
  console.log(`  -H 'Content-Type: application/json' \\`);
  console.log(`  -d '${JSON.stringify(envelope).replace(/'/g, "'\\''")}'`);
}

async function modoTrial() {
  const competencia = "2021-01";
  const declaracao = buildDeclaracaoPayload({
    contribuinteCnpj: TRIAL_CNPJ,
    competencia,
    indicadorTransmissao: false,
    regimeApuracao: "COMPETENCIA",
    tipoDeclaracao: 1,
    atividades: [
      // varie o idAtividade aqui pra testar a pergunta 1B
      { idAtividade: 11, valorInterno: 140100.0, valorExterno: 0, sujeitoFatorR: true },
    ],
    receitasBrutasAnteriores: pasAnteriores(competencia).map((pa) => ({ pa, valorInterno: 39175.0, valorExterno: 0 })),
    folhasSalario: pasAnteriores(competencia).map((pa) => ({ pa, valor: 2083.33 })),
  });
  imprimir({ cnpj: TRIAL_CNPJ, competencia, declaracao });
}

async function modoEmpresa(portalClientId, competencia) {
  const dados = await getDadosFechamento({ portalClientId, competencia });
  const atividades = (dados.atividades || []).filter((a) => a && a.idAtividade != null);
  const rbtDetalhe = Array.isArray(dados.snapshot?.rbt12Detalhe) ? dados.snapshot.rbt12Detalhe : null;
  // receitasBrutasAnteriores: usa o cache (detalhePorMes) se houver; senão zera (trial valida estrutura)
  const cache = await prisma.rbtExtratoCache.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  }).catch(() => null);
  const rba = Array.isArray(cache?.detalhePorMes) && cache.detalhePorMes.length
    ? cache.detalhePorMes
    : pasAnteriores(competencia).map((pa) => ({ pa, valorInterno: 0, valorExterno: 0 }));
  const folha = Array.isArray(dados.folhaMensal12) && dados.folhaMensal12.length
    ? dados.folhaMensal12
    : pasAnteriores(competencia).map((pa) => ({ pa, valor: 0 }));

  console.log(`Empresa: ${dados.razao} · CNPJ ${dados.cnpj} · ${competencia}`);
  console.log(`⚠ Pro TRIAL, troque o CNPJ por um fictício (ex: ${TRIAL_CNPJ}) — o real não existe lá.`);
  const declaracao = buildDeclaracaoPayload({
    contribuinteCnpj: dados.cnpj,
    competencia,
    indicadorTransmissao: false,
    regimeApuracao: dados.regimeApuracao,
    tipoDeclaracao: 1,
    atividades,
    receitasBrutasAnteriores: rba,
    folhasSalario: folha,
  });
  imprimir({ cnpj: dados.cnpj, competencia, declaracao });
}

(async () => {
  const args = process.argv.slice(2);
  if (args[0] === "--trial") {
    await modoTrial();
  } else if (args.length === 2) {
    await modoEmpresa(args[0], args[1]);
  } else {
    console.error("uso: <portalClientId> <YYYY-MM>  |  --trial");
    process.exit(1);
  }
})().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
