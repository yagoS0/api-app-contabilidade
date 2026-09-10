// Anexo I v1.01-20260209, RN E0592 e E0585; XSD TCExigSuspensa.
export function validarTributacaoMunicipal(perfil = {}) {
  const erros = [];
  const trib = String(perfil.tribISSQN || "1");
  const tem = (v) => v !== null && v !== undefined && v !== "";
  const imunidade = tem(perfil.tpImunidade);
  if ((trib === "2") !== imunidade) erros.push({ campo: "tpImunidade", motivo: "Tipo de imunidade é obrigatório somente para tributação do ISSQN igual a Imunidade (E0592)." });
  if (imunidade && !/^[0-5]$/.test(String(perfil.tpImunidade))) erros.push({ campo: "tpImunidade", motivo: "Tipo de imunidade deve ser um dos códigos de 0 a 5 do leiaute." });
  const susp = tem(perfil.exigSuspTipo) || tem(perfil.exigSuspProcesso);
  if (susp && trib !== "1") erros.push({ campo: "exigSuspTipo", motivo: "Suspensão de exigibilidade só é permitida em operação tributável (E0585)." });
  if (susp && (!/^[12]$/.test(String(perfil.exigSuspTipo ?? "")) || !/^\d{30}$/.test(String(perfil.exigSuspProcesso ?? "")))) erros.push({ campo: "exigSuspProcesso", motivo: "Informe o tipo de suspensão e o número do processo com exatamente 30 dígitos, conforme o leiaute nacional." });
  return erros;
}

export function tributacaoMunicipalDoPerfil(perfil) {
  const p = perfil || {};
  const erros = validarTributacaoMunicipal(p);
  if (erros.length) throw Object.assign(new Error(erros.map((e) => e.motivo).join(" ")), { code: "NFSE_TRIBUTACAO_MUNICIPAL_INVALIDA" });
  if (String(p.tribISSQN) === "3") throw Object.assign(new Error("Emissão de exportação ainda exige os dados de comércio exterior não disponíveis neste emissor. Utilize o Portal Nacional para esta operação."), { code: "NFSE_EXPORTACAO_NAO_SUPORTADA" });
  // Somente valores validados por enumeração/pattern entram nas tags.
  return (p.tpImunidade != null && p.tpImunidade !== "" ? `<tpImunidade>${p.tpImunidade}</tpImunidade>` : "")
    + (p.exigSuspTipo ? `<exigSusp><tpSusp>${p.exigSuspTipo}</tpSusp><nProcesso>${p.exigSuspProcesso}</nProcesso></exigSusp>` : "");
}
