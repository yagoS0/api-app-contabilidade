import { useMemo, useState } from "react";

export function getInitialCompanyFormState() {
  return {
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: "",
    email: "",
    guideNotificationEmail: "",
    hasProlabore: false,
    temFolha: false,
    empresaZerada: false,
    telefone: "",
    regimeTributario: "SIMPLES",
    cnaePrincipal: "",
    cnaesSecundarios: "", // string separada por vírgula; o realApi normaliza pra array
    enderecoRua: "",
    enderecoNumero: "",
    enderecoBairro: "",
    enderecoCidade: "",
    enderecoUf: "",
    enderecoCep: "",
    enderecoComplemento: "",
    // ── Ficha de cadastro ──
    inscricaoMunicipal: "",
    inscricaoMunicipalData: "",
    inscricaoEstadual: "",
    inscricaoEstadualData: "",
    porte: "",
    naturezaJuridica: "",
    capitalSocial: "",
    dataAbertura: "",
    abriuCom: "",
    numeroRegistro: "",
    tipoRegistro: "",
    diarioNumero: "",
    desoneracao: false,
    alteracaoNumero: "",
    alteracaoData: "",
    socios: [],
    regimeHistorico: [],
  };
}

// ISO/Date → "YYYY-MM-DD" pro <input type="date">.
function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function mapCompanyToEditForm(company) {
  const legacy = company?.legacyCompany && typeof company.legacyCompany === "object" ? company.legacyCompany : {};
  const endereco = legacy?.enderecoJson && typeof legacy.enderecoJson === "object" ? legacy.enderecoJson : {};
  return {
    ownerName: String(company?.ownerName || "").trim(),
    ownerEmail: String(company?.ownerEmail || company?.email || "").trim(),
    ownerPassword: "",
    razaoSocial: String(legacy?.razaoSocial || company?.razao || "").trim(),
    nomeFantasia: String(legacy?.nomeFantasia || "").trim(),
    cnpj: String(company?.cnpj || "").trim(),
    email: String(company?.email || "").trim(),
    guideNotificationEmail: String(company?.guideNotificationEmail || "").trim(),
    hasProlabore: Boolean(company?.hasProlabore),
    temFolha: Boolean(company?.temFolha),
    empresaZerada: Boolean(company?.empresaZerada),
    telefone: String(legacy?.telefone || company?.telefone || "").trim(),
    regimeTributario: String(legacy?.regimeTributario || "SIMPLES"),
    cnaePrincipal: String(legacy?.cnaePrincipal || "").trim(),
    cnaesSecundarios: Array.isArray(legacy?.cnaesSecundarios) ? legacy.cnaesSecundarios.join(", ") : "",
    enderecoRua: String(endereco?.rua || "").trim(),
    enderecoNumero: String(endereco?.numero || "").trim(),
    enderecoBairro: String(endereco?.bairro || "").trim(),
    enderecoCidade: String(endereco?.cidade || company?.municipio || "").trim(),
    enderecoUf: String(endereco?.uf || company?.uf || "").trim().toUpperCase(),
    enderecoCep: String(endereco?.cep || "").trim(),
    enderecoComplemento: String(endereco?.complemento || "").trim(),
    // ── Ficha de cadastro ──
    inscricaoMunicipal: String(company?.inscricaoMunicipal || legacy?.inscricaoMunicipal || "").trim(),
    inscricaoMunicipalData: toDateInput(legacy?.inscricaoMunicipalData),
    inscricaoEstadual: String(legacy?.inscricaoEstadual || "").trim(),
    inscricaoEstadualData: toDateInput(legacy?.inscricaoEstadualData),
    porte: String(legacy?.porte || "").trim(),
    naturezaJuridica: String(legacy?.naturezaJuridica || "").trim(),
    capitalSocial: legacy?.capitalSocial != null ? String(legacy.capitalSocial) : "",
    dataAbertura: toDateInput(legacy?.dataAbertura),
    abriuCom: String(legacy?.abriuCom || "").trim(),
    numeroRegistro: String(legacy?.numeroRegistro || "").trim(),
    tipoRegistro: String(legacy?.tipoRegistro || "").trim(),
    diarioNumero: String(legacy?.diarioNumero || "").trim(),
    desoneracao: Boolean(legacy?.desoneracao),
    alteracaoNumero: String(legacy?.alteracaoNumero || "").trim(),
    alteracaoData: toDateInput(legacy?.alteracaoData),
    socios: Array.isArray(legacy?.partners)
      ? legacy.partners.map((p) => ({
          name: String(p.name || ""),
          documento: String(p.documento || ""),
          participacao: p.participacao != null ? String(p.participacao) : "",
          rg: String(p.rg || ""),
          rgOrgaoEmissor: String(p.rgOrgaoEmissor || ""),
          dataNascimento: toDateInput(p.dataNascimento),
          dataSaida: toDateInput(p.dataSaida),
          representante: Boolean(p.representante),
        }))
      : [],
    regimeHistorico: Array.isArray(legacy?.regimeHistorico)
      ? legacy.regimeHistorico.map((r) => ({
          regime: String(r.regime || "SIMPLES"),
          vigenciaInicio: toDateInput(r.vigenciaInicio),
          vigenciaFim: toDateInput(r.vigenciaFim),
          impostos: Array.isArray(r.impostos) ? r.impostos.join("/") : "",
          desoneracao: Boolean(r.desoneracao),
        }))
      : [],
  };
}

export function useCompanyForm(initialState = getInitialCompanyFormState()) {
  const [form, setForm] = useState(initialState);

  const actions = useMemo(
    () => ({
      setField(name, value) {
        setForm((old) => ({ ...old, [name]: value }));
      },
      replace(next) {
        setForm(next || getInitialCompanyFormState());
      },
      reset() {
        setForm(getInitialCompanyFormState());
      },
    }),
    []
  );

  return { form, setForm, ...actions };
}
