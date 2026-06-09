// Gera as 3 chamadas de validação do trial (pergunta 1/2/3) usando o MESMO
// buildDeclaracaoPayload — nada inventado à mão.
//   Chamada 1: payload mínimo feliz (revenda, atividade id 1) — valida client/parse.
//   Chamada 2: o de --trial (serviço Fator-R id 11) — já no gerar-payload-pgdasd.js.
//   Chamada 3: payload propositalmente errado (Fator-R SEM folha + 11 RBAs) —
//              mapeia erros obrigatórios condicionais. NÃO transmite (false).
import { buildDeclaracaoPayload } from "../src/application/fiscal/serpro/PgdasSimulacaoService.js";

const BASE = "https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Declarar";
const CNPJ = "00000000000100";

function paList(comp, n = 12) {
  const [y, m] = comp.split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`); }
  return out;
}
function envelope(decl) {
  return {
    contratante: { numero: CNPJ, tipo: 2 },
    autorPedidoDados: { numero: CNPJ, tipo: 2 },
    contribuinte: { numero: CNPJ, tipo: 2 },
    pedidoDados: { idSistema: "PGDASD", idServico: "TRANSDECLARACAO11", versaoSistema: "1.0", dados: JSON.stringify(decl) },
  };
}
function curl(decl) {
  return `curl -X POST '${BASE}' \\\n  -H 'Authorization: Bearer SEU_TOKEN_TRIAL' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(envelope(decl)).replace(/'/g, "'\\''")}'`;
}

const comp = "2021-01";

// CHAMADA 1 — mínimo feliz: revenda interna (id 1), sem folha (não é Fator-R)
const c1 = buildDeclaracaoPayload({
  contribuinteCnpj: CNPJ, competencia: comp, indicadorTransmissao: false,
  regimeApuracao: "COMPETENCIA", tipoDeclaracao: 1,
  atividades: [{ idAtividade: 1, valorInterno: 10000, valorExterno: 0 }],
  receitasBrutasAnteriores: paList(comp).map((pa) => ({ pa, valorInterno: 0, valorExterno: 0 })),
  folhasSalario: [],
});

// CHAMADA 3 — erro proposital: Fator-R (id 11) SEM folha + só 11 RBAs (falta 1)
const c3 = buildDeclaracaoPayload({
  contribuinteCnpj: CNPJ, competencia: comp, indicadorTransmissao: false,
  regimeApuracao: "COMPETENCIA", tipoDeclaracao: 1,
  atividades: [{ idAtividade: 11, valorInterno: 140100, valorExterno: 0, sujeitoFatorR: true }],
  receitasBrutasAnteriores: paList(comp, 11).map((pa) => ({ pa, valorInterno: 39175, valorExterno: 0 })),
  folhasSalario: [], // <- ausente de propósito (atividade Fator-R presente)
});

console.log("================ CHAMADA 1 — mínimo feliz (revenda id 1) ================\n");
console.log(curl(c1));
console.log("\n\n================ CHAMADA 3 — erro proposital (Fator-R sem folha + 11 RBAs) ================\n");
console.log(curl(c3));
console.log("\n\n(Chamada 2 = node apps/api/scripts/gerar-payload-pgdasd.js --trial)");
