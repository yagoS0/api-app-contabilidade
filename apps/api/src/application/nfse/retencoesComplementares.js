// RN DPS_NFS-e E0699/E0700 (Anexo I 1.01-20260209).
// Valores declarados na operação; nenhuma alíquota/enquadramento é presumido.
export function normalizarRetencoesComplementares(entrada, valorServicos) {
  if (entrada == null) return null;
  if (typeof entrada !== "object" || Array.isArray(entrada)) throw new Error("Informe as retenções como valores monetários por tributo.");
  const r = {};
  for (const chave of Object.keys(entrada)) {
    if (!["vRetIRRF", "vRetCP"].includes(chave)) throw new Error(`Retenção não reconhecida: ${chave}.`);
    const v = entrada[chave];
    if (v == null || v === "") continue;
    if (!["string", "number"].includes(typeof v) || !/^\d+(\.\d{1,2})?$/.test(String(v))) throw new Error(`${chave}: informe reais com até duas casas decimais.`);
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n >= valorServicos) throw new Error(`${chave}: o valor deve ser maior que zero e menor que o valor do serviço (E0699/E0700).`);
    r[chave] = n;
  }
  if (Object.values(r).reduce((a, b) => a + b, 0) >= valorServicos) throw new Error("As retenções complementares devem ser menores que o valor do serviço.");
  return Object.keys(r).length ? r : null;
}

export function xmlRetencoesComplementares(entrada, valorServicos) {
  try {
    const r = normalizarRetencoesComplementares(entrada, valorServicos);
    return r ? ["vRetCP", "vRetIRRF"].filter((k) => r[k] != null).map((k) => `<${k}>${r[k].toFixed(2)}</${k}>`).join("") : "";
  } catch (err) { throw Object.assign(err, { code: "NFSE_RETENCOES_COMPLEMENTARES_INVALIDAS" }); }
}
