const textoDecimal = v => typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
const digitos = v => String(v || "").replace(/\D/g, "");

export function prepararConversao(onboarding) {
  const d = onboarding?.dados || {};
  return {
    cnpj: digitos(onboarding?.cnpj), razaoSocial: onboarding?.razaoSocial || "", nomeFantasia: d.nomeFantasia || "",
    // Intenção tributária não vira regime efetivo. O contador confirma o registro concluído.
    regimeTributario: "", cnaePrincipal: "", cnaesSecundarios: "", telefone: d.responsavelTelefone || "",
    ownerEmail: onboarding?.responsavelEmail || "", ownerName: onboarding?.responsavelNome || "", ownerPassword: "",
    telefoneResponsavel: d.responsavelTelefone || "", guideNotificationEmail: onboarding?.responsavelEmail || "",
    whatsappAutorizado: false, cadastroConferido: false,
    hasProlabore: d.temProLabore === true, temFolha: Number(d.qtdFuncionarios || 0) > 0,
    capitalSocial: textoDecimal(d.capitalSocialPretendido ?? d.capitalSocial),
    socios: (d.socios || []).map(s => ({ ...s, nome: s.nome || s.name || "", cpf: s.cpf || s.documento || "", participacao: textoDecimal(s.participacao) })),
    naturezaJuridica: d.naturezaJuridica || "", porte: d.porte || "", dataAbertura: d.dataAbertura || "",
    inscricaoMunicipal: "", inscricaoEstadual: "",
    endereco: { rua: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", cep: "" },
  };
}

export function aplicarConsultaNaConversao(atual, consulta) {
  const proximo = { ...atual, cadastroConferido: false };
  for (const campo of ["razaoSocial", "nomeFantasia", "telefone", "cnaePrincipal", "naturezaJuridica", "porte", "dataAbertura"]) {
    if (consulta[campo]) proximo[campo] = consulta[campo];
  }
  proximo.cnaesSecundarios = (consulta.cnaesSecundarios || []).join(", ");
  if (consulta.capitalSocial != null) proximo.capitalSocial = textoDecimal(consulta.capitalSocial);
  proximo.endereco = { ...atual.endereco, ...consulta.endereco };
  return proximo;
}

export function payloadConversao(form, { senhaExigida = true } = {}) {
  return {
    ownerEmail: form.ownerEmail.trim().toLowerCase(), ownerName: form.ownerName || null,
    ...(senhaExigida ? { ownerPassword: form.ownerPassword } : {}), hasProlabore: Boolean(form.hasProlabore), temFolha: Boolean(form.temFolha),
    contato: { nome: form.ownerName, email: form.ownerEmail.trim().toLowerCase(), telefone: form.telefoneResponsavel, whatsappAutorizado: form.whatsappAutorizado === true },
    company: {
      razaoSocial: form.razaoSocial.trim(), nomeFantasia: form.nomeFantasia || null, cnpj: digitos(form.cnpj),
      regimeTributario: form.regimeTributario, cnaePrincipal: form.cnaePrincipal.trim(),
      cnaesSecundarios: String(form.cnaesSecundarios || "").split(/[,;\n]/).map(v => v.trim()).filter(Boolean),
      telefone: form.telefone || null, endereco: form.endereco, guideNotificationEmail: form.guideNotificationEmail || null,
      capitalSocial: form.capitalSocial || null, socios: form.socios,
      naturezaJuridica: form.naturezaJuridica || null, porte: form.porte || null, dataAbertura: form.dataAbertura || null,
      inscricaoMunicipal: form.inscricaoMunicipal || null, inscricaoEstadual: form.inscricaoEstadual || null,
    },
  };
}
