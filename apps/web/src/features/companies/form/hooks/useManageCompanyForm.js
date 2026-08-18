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
    // Código IBGE (7 dígitos) do município EMISSOR da NFS-e — o `cLocEmi` da DPS. Nasce vazio e
    // NUNCA é pré-preenchido: o contador escolhe na lista oficial (ver `SeletorMunicipioIbge`).
    codigoMunicipioIbge: "",
    // Configuração da emissão de NFS-e (`cTribNac`, `cTribMun` e a série da DPS). ⚠ Nascem vazios e
    // NUNCA são pré-preenchidos — nem a série: ela entra no identificador de toda nota emitida, e um
    // valor escolhido pelo sistema seria indistinguível de um valor conferido pelo contador.
    codigoServicoNacional: "",
    // Os N códigos de serviço que a empresa pode usar (decisão do dono, 16/08/2026). Escolhidos na
    // lista oficial versionada — nunca derivados do CNAE.
    codigosServicoNacional: [],
    codigoServicoMunicipal: "",
    rpsSerie: "",
    // Carga tributária aproximada da empresa NÃO optante (Lei 12.741/2012). ⚠ Nascem vazios e
    // NUNCA são pré-preenchidos — nem com 0. Zero é uma AFIRMAÇÃO ("conferi, é zero") que vai
    // impressa ao tomador; um zero escolhido pelo sistema seria indistinguível de um zero
    // conferido pelo contador. Campo vazio é a verdade sobre uma empresa não configurada.
    pTotTribFed: "",
    pTotTribEst: "",
    pTotTribMun: "",
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
    // ⚠ Só de `legacyCompany`: a coluna vive em `Company`, não em `PortalClient`. Ler o
    // `municipio`/`uf` do topo como fallback seria transformar o TEXTO do endereço em código.
    codigoMunicipioIbge: String(legacy?.codigoMunicipioIbge || "").trim(),
    // ⚠ Só de `legacyCompany`: as três colunas vivem em `Company`, não em `PortalClient`. E nada de
    // fallback derivado (CNAE → código de serviço, ou uma série "1" quando vier vazio): campo vazio
    // aqui é a informação de que a empresa não está configurada para emitir.
    codigoServicoNacional: String(legacy?.codigoServicoNacional || "").trim(),
    // ⚠ CAI PARA O CAMPO SINGULAR quando a lista está vazia — e isso não é derivação, é o MESMO
    // dado no formato antigo. Uma empresa cadastrada antes de 16/08/2026 (ou antes de a migration
    // ser aplicada) tem só o campo de um código; abrir o formulário com a lista vazia faria o
    // contador achar que nada foi salvo e recadastrar.
    codigosServicoNacional: Array.isArray(legacy?.codigosServicoNacional) && legacy.codigosServicoNacional.length
      ? legacy.codigosServicoNacional.map((c) => String(c).trim()).filter(Boolean)
      : (String(legacy?.codigoServicoNacional || "").trim() ? [String(legacy.codigoServicoNacional).trim()] : []),
    codigoServicoMunicipal: String(legacy?.codigoServicoMunicipal || "").trim(),
    rpsSerie: String(legacy?.rpsSerie || "").trim(),
    // ⚠ `!= null`, NUNCA `|| ""`: a coluna é `Decimal?` e um `0` gravado é um percentual
    // LEGÍTIMO (serviço não tem ICMS — a NFS-e real de referência declara 0,00 no estadual).
    // Com `||` o zero conferido pelo contador reabriria o formulário em branco, ele salvaria de
    // novo, e a empresa voltaria a não emitir. Mesma armadilha do `?? ""` do FechamentoModal.
    pTotTribFed: legacy?.pTotTribFed != null ? String(legacy.pTotTribFed) : "",
    pTotTribEst: legacy?.pTotTribEst != null ? String(legacy.pTotTribEst) : "",
    pTotTribMun: legacy?.pTotTribMun != null ? String(legacy.pTotTribMun) : "",
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
