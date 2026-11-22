// Política pura da obra por nota. A relação CEP/município não é validável por formato.
export const CAMPOS_ENDERECO_OBRA = [
  ["CEP", "CEP da obra", 9], ["xLgr", "Logradouro da obra", 255],
  ["nro", "Número da obra", 60], ["xCpl", "Complemento da obra (opcional)", 156],
  ["xBairro", "Bairro da obra", 60],
];
export const AVISO_CEP_OBRA = "Confira: o CEP da obra deve pertencer ao município da prestação. Informe o endereço da obra, não o do tomador.";
export const ENDERECO_OBRA_VAZIO = Object.fromEntries(CAMPOS_ENDERECO_OBRA.map(([k]) => [`obra${k}`, ""]));
export function normalizarObraDaNota(v) {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["cObra", "cCIB", "inscImobFisc", "end"].includes(k))) throw new Error("Obra: campos inválidos.");
  if (Object.hasOwn(v, "end")) {
    if (Object.hasOwn(v, "cObra") || Object.hasOwn(v, "cCIB")) throw new Error("Obra: informe endereço ou identificador, exclusivamente uma alternativa.");
    let inscricao;
    if (Object.hasOwn(v, "inscImobFisc")) {
      if (typeof v.inscImobFisc !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(v.inscImobFisc)) throw new Error("Inscrição imobiliária: informe texto sem caracteres de controle.");
      inscricao = v.inscImobFisc.trim();
      if (inscricao.length > 30) throw new Error("Inscrição imobiliária: use até 30 caracteres compatíveis com o leiaute.");
    }
    const end = v.end;
    if (!end || typeof end !== "object" || Array.isArray(end) || Object.keys(end).some(k => !CAMPOS_ENDERECO_OBRA.some(([campo]) => campo === k))) throw new Error("Endereço da obra: campos inválidos; informe somente endereço nacional.");
    const r = {};
    for (const [k, rotulo, limite] of CAMPOS_ENDERECO_OBRA) {
      if (!Object.hasOwn(end, k) && k === "xCpl") continue;
      if (typeof end[k] !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(end[k])) throw new Error(`${rotulo}: informe texto sem caracteres de controle.`);
      const valor = end[k].trim();
      if (k === "CEP") {
        if (!/^\d{5}-?\d{3}$/.test(valor)) throw new Error("CEP da obra: informe 8 dígitos.");
        r[k] = valor.replace("-", "");
      } else {
        if ((!valor && k !== "xCpl") || valor.length > limite) throw new Error(`${rotulo}: informe de 1 a ${limite} caracteres.`);
        if (valor && !/^[\x21-\xFF](?:[\x20-\xFF]*[\x21-\xFF])?$/.test(valor)) throw new Error(`${rotulo}: use caracteres compatíveis com o leiaute. Acentos são permitidos; aspas curvas, travessões e emojis não.`);
        if (valor) r[k] = valor;
      }
    }
    return { ...(inscricao ? { inscImobFisc: inscricao } : {}), end: r };
  }
  // Preservar normalização e mensagens dos identificadores legados.
  if (Object.values(v).some(val => typeof val !== "string" || /[\u0000-\u001f\u007f]/.test(val))) throw new Error("Obra: informe texto sem caracteres de controle.");
  const r = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.trim()]).filter(([, val]) => val));
  if (Boolean(r.cObra) === Boolean(r.cCIB)) throw new Error("Obra: informe CNO/CEI ou CIB, exclusivamente um identificador.");
  if ((r.cObra && r.cObra.length > 30) || (r.cCIB && r.cCIB.length !== 8) || (r.inscImobFisc && r.inscImobFisc.length > 30)) throw new Error("Obra: CNO/CEI e inscrição têm até 30 caracteres; CIB tem 8 caracteres.");
  return r;
}

export function resumoEnderecoObra(end) {
  return [end.xLgr, end.nro, end.xCpl, end.xBairro, `CEP ${end.CEP}`].filter(Boolean).join(" · ");
}
