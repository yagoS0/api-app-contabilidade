// Apenas apresentação: nenhuma classificação ou permissão fiscal é alterada.
export function somenteServicosSemIE(inscricaoEstadual, perfil) {
  if (inscricaoEstadual === undefined) return false;
  const ie = String(inscricaoEstadual || "").trim().toUpperCase();
  if (ie && ie !== "ISENTO" && ie !== "ISENTA") return false;
  const atividades = perfil?.candidatos || [];
  return atividades.length > 0 && atividades.every(a =>
    !a.impeditivo && !a.revisao && !a.ambiguo && /^SERVICO_/.test(a.tipoReceita || ""));
}
