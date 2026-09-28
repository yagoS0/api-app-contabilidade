import { BLOCOS } from "./danfseLeiaute.js";

// A tabela original permanece como referência da NT. A apresentação reserva a
// primeira coluna do ISSQN para o título, como no modelo fornecido pelo usuário.
export const BLOCOS_IMPRESSAO = BLOCOS.map((bloco) => ({
  ...bloco,
  ...(bloco.id === "cabecalho" ? { sup: 0, alt: 1.46 } : {}),
  campos: bloco.campos.map((campo) => {
    if (campo.id === "tribISSQN") return { ...campo, esq: 5.41 };
    if (campo.id === "locIncid") return { ...campo, esq: 10.51 };
    if (campo.id === "regApTribSN") return { ...campo, esq: 5.41, larg: 15.29 };
    if (campo.id === "logomarca") return { ...campo, esq: 0.4, sup: 0.1, larg: 5.3, alt: 1.2 };
    if (campo.id === "quadroDescricao") return { ...campo, larg: 9.0 };
    if (["quadroIdentMunicipio", "municipio", "ambGer", "tpAmb"].includes(campo.id)) {
      return { ...campo, esq: 14.5, larg: 6.2 };
    }
    return campo;
  }),
}));

const MOEDA = new Set([
  "vCalcBM", "vDedRed", "vDescIncondIssqn", "vBC", "vISSQN", "vRetIRRF",
  "vRetCP", "contribSociaisRetidas", "vPis", "vCofins", "exclusoesReducoesBc",
  "bcAposExclusoes", "vIBSMun", "vIBSUF", "vIBSTot", "vCBS", "vServ",
  "vDescIncond", "vDescCond", "vTotalRet", "vLiq", "totalIbsCbs", "vTotNF",
]);
const PERCENTUAL = new Set(["pAliqAplic", "pAliqEfetMun", "pAliqEfetUF", "pCBS", "pAliqEfetCBS"]);

// Somente apresentação: não recalcula impostos nem transforma ausência em zero.
export function apresentarValor(id, texto) {
  const valor = String(texto);
  if (/^-?[\d.]+,\d+$/.test(valor)) {
    if (MOEDA.has(id)) return `R$ ${valor}`;
    if (PERCENTUAL.has(id)) return `${valor} %`;
  }
  if (/Fone$/.test(id) && /^\d{10,11}$/.test(valor)) {
    return valor.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
  }
  return valor;
}
