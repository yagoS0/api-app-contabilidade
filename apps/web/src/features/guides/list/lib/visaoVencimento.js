// Vencimento é data civil: não converter meia-noite UTC para o dia anterior no Brasil.
export const mesDoVencimento = (guia) => String(guia.vencimento || "").match(/^\d{4}-\d{2}(?=-)/)?.[0] || "";

export function guiasDaVisao(guias, { visao, mes, competencia }) {
  return guias.filter((g) => {
    const vencimento = mesDoVencimento(g);
    if (visao === "competencia") return g.competencia === competencia;
    if (visao === "todas") return true;
    if (g.status === "VAZIO") return false;
    if (visao === "anteriores") return vencimento && vencimento < mes && g.paymentStatus !== "PAID";
    if (visao === "semVencimento") return !vencimento && g.paymentStatus !== "PAID";
    return vencimento === mes;
  });
}
