
export const CAMPOS_VAZIOS = Object.freeze({
  cnpjFornecedor: "",
  padraoDescricao: "",
  valorMin: "",
  valorMax: "",
  contaDestino: "",
  contaCredito: "",
  lancaSozinha: false,
  diaDoLancamento: "",
});

const brl = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
};

export function iniciaisDaLinha(item, { contaDestino = null, contaCredito = null } = {}) {
  const valor = item?.valorAjustado ?? item?.valor;
  const n = Number(valor);
  const valorTexto = Number.isFinite(n) && n > 0 ? String(n) : "";
  return {
    ...CAMPOS_VAZIOS,
    cnpjFornecedor: String(item?.cnpjFornecedor || "").replace(/\D+/g, ""),
    // ⚠ A descrição ORIGINAL, não a normalizada: o contador lê e apara; a normalização é do motor.
    padraoDescricao: item?.cnpjFornecedor ? "" : String(item?.descricaoOriginal || ""),
    valorMin: valorTexto,
    valorMax: valorTexto,
    contaDestino: contaDestino || "",
    contaCredito: contaCredito || "",
  };
}
export { brl };

