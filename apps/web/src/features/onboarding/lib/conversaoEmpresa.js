const textoDecimal = v => typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
const digitos = v => String(v || "").replace(/\D/g, "");

export function prepararConversao(onboarding) {
  const d = onboarding?.dados || {};
  const cadastro = d.cadastroCnpj?.cnpj === digitos(onboarding?.cnpj || d.cnpj) ? d.cadastroCnpj.empresa || {} : {};
  return {
    cnpj: digitos(onboarding?.cnpj), razaoSocial: onboarding?.razaoSocial || "", nomeFantasia: d.nomeFantasia || "",
    // Intenção tributária não vira regime efetivo. O contador confirma o registro concluído.
    regimeTributario: "", cnaePrincipal: cadastro.cnaePrincipal || "", cnaesSecundarios: (cadastro.cnaesSecundarios || []).join(", "), telefone: cadastro.telefone || d.responsavelTelefone || "",
    ownerEmail: onboarding?.responsavelEmail || "", ownerName: onboarding?.responsavelNome || "", ownerPassword: "",
    telefoneResponsavel: d.responsavelTelefone || "", guideNotificationEmail: onboarding?.responsavelEmail || "",
    whatsappAutorizado: false, cadastroConferido: false,
    hasProlabore: d.temProLabore === true, temFolha: Number(d.qtdFuncionarios || 0) > 0,
    capitalSocial: textoDecimal(cadastro.capitalSocial ?? d.capitalSocialPretendido ?? d.capitalSocial),
    socios: (d.socios || []).map(s => ({ ...s, nome: s.nome || s.name || "", cpf: s.cpf || s.documento || "", participacao: textoDecimal(s.participacao) })),
    naturezaJuridica: cadastro.naturezaJuridica || d.naturezaJuridica || "", porte: cadastro.porte || d.porte || "", dataAbertura: cadastro.dataAbertura || d.dataAbertura || "",
    inscricaoMunicipal: "", inscricaoEstadual: "",
    endereco: { rua: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", cep: "", ...cadastro.endereco },
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

// Reconsulta explícita atualiza somente campos não editados desde o início da requisição.
export function aplicarConsultaNaConversaoPreservandoEdicoes(atual, consulta, inicio) {
  const preenchido = aplicarConsultaNaConversao(atual, consulta);
  for (const campo of Object.keys(preenchido)) {
    if (campo !== "endereco" && campo !== "cadastroConferido" && atual[campo] !== inicio[campo]) preenchido[campo] = atual[campo];
  }
  for (const campo of Object.keys(preenchido.endereco || {})) {
    if (atual.endereco?.[campo] !== inicio.endereco?.[campo]) preenchido.endereco[campo] = atual.endereco?.[campo];
  }
  return preenchido;
}
