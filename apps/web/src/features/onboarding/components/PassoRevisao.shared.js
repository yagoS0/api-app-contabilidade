import { formatarEnderecoAbertura } from '@contabilidade/shared/onboarding';


export function formatarValor(descritor, valor) {
  if (descritor.tipo === "endereco") return formatarEnderecoAbertura(valor);
  if (descritor.tipo === "moeda" && typeof valor === "number") return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (valor === "NAO_SEI") return "Não sei / preciso confirmar";
  if (valor === "NAO_APLICAVEL") return "Não se aplica";
  if (descritor.tipo === "booleano") {
    if (valor === true) return "Sim";
    if (valor === false) return "Não";
    return null;
  }
  if (descritor.tipo === "lista") {
    if (!Array.isArray(valor) || valor.length === 0) return null;
    return valor
      .map((linha) => (descritor.colunas || []).map((c) => formatarValor({ ...c, tipo: c.tipo || (typeof linha?.[c.campo] === "boolean" ? "booleano" : "texto") }, linha?.[c.campo])).filter((v) => v != null && v !== "").join(" · "))
      .filter(Boolean)
      .join("  |  ");
  }
  if (descritor.tipo === "escolha") {
    const opcao = (descritor.opcoes || []).find((o) => o.valor === valor);
    return opcao ? opcao.rotulo : (String(valor ?? "").trim() || null);
  }
  return String(valor ?? "").trim() || null;
}
