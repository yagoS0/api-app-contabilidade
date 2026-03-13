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
    telefone: "",
    regimeTributario: "SIMPLES",
    cnaePrincipal: "",
    enderecoRua: "",
    enderecoNumero: "",
    enderecoBairro: "",
    enderecoCidade: "",
    enderecoUf: "",
    enderecoCep: "",
    enderecoComplemento: "",
  };
}

export function mapCompanyToEditForm(company) {
  const legacy = company?.legacyCompany && typeof company.legacyCompany === "object" ? company.legacyCompany : {};
  const endereco = legacy?.enderecoJson && typeof legacy.enderecoJson === "object" ? legacy.enderecoJson : {};
  return {
    ownerName: "",
    ownerEmail: String(company?.email || "").trim(),
    ownerPassword: "",
    razaoSocial: String(legacy?.razaoSocial || company?.razao || "").trim(),
    nomeFantasia: String(legacy?.nomeFantasia || "").trim(),
    cnpj: String(company?.cnpj || "").trim(),
    email: String(company?.email || "").trim(),
    telefone: String(legacy?.telefone || company?.telefone || "").trim(),
    regimeTributario: String(legacy?.regimeTributario || "SIMPLES"),
    cnaePrincipal: String(legacy?.cnaePrincipal || "").trim(),
    enderecoRua: String(endereco?.rua || "").trim(),
    enderecoNumero: String(endereco?.numero || "").trim(),
    enderecoBairro: String(endereco?.bairro || "").trim(),
    enderecoCidade: String(endereco?.cidade || company?.municipio || "").trim(),
    enderecoUf: String(endereco?.uf || company?.uf || "").trim().toUpperCase(),
    enderecoCep: String(endereco?.cep || "").trim(),
    enderecoComplemento: String(endereco?.complemento || "").trim(),
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

