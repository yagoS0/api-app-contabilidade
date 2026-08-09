// Consulta de CNPJ na BrasilAPI, mapeada para o `dados` do onboarding.
//
// Reusa a MESMA forma de `fetchCnpjData`/`applyBrasilApiData` de
// `features/companies/form/components/renderCompanyForm.jsx` — inclusive o mapeamento de porte.
// O que muda é só o destino: lá os campos vão para o formulário da empresa, aqui para o rascunho.
//
// ⚠ A CHAMADA SAI DO BROWSER, SEM PROXY. Ela cai com rede corporativa, bloqueador de conteúdo,
// offline e throttle da própria BrasilAPI. O caminho de falha é REQUISITO, não polimento: a tela
// tem de continuar preenchível à mão. Por isso esta função nunca lança para fora sem classificar —
// devolve `{ ok: false, motivo }` e quem chama decide o que mostrar.

const BASE = "https://brasilapi.com.br/api/cnpj/v1";

export function soDigitosCnpj(valor) {
  return String(valor ?? "").replace(/\D+/g, "").slice(0, 14);
}

export function formatarCnpj(valor) {
  const d = soDigitosCnpj(valor);
  if (d.length !== 14) return String(valor ?? "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function porteDaBrasilApi(data) {
  const raw = String(data?.porte || data?.descricao_porte || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("MICRO EMPRESA") || raw === "ME") return "MICROEMPRESA";
  if (raw.includes("PEQUENO PORTE") || raw === "EPP") return "EMPRESA DE PEQUENO PORTE";
  if (raw.includes("DEMAIS")) return "DEMAIS";
  return raw;
}

/**
 * ⚠ Situação cadastral ≠ ATIVA (BAIXADA / INAPTA / SUSPENSA) muda a conversa inteira, e vem de
 * graça na mesma resposta. Devolvida separada para a tela poder destacá-la.
 */
function situacaoCadastral(data) {
  const texto = String(data?.descricao_situacao_cadastral || "").trim().toUpperCase();
  return {
    texto: texto || null,
    ativa: texto === "ATIVA",
    motivo: String(data?.motivo_situacao_cadastral || "").trim() || null,
    data: String(data?.data_situacao_cadastral || "").trim() || null,
  };
}

/**
 * @returns {Promise<{ok: true, empresa, situacao, bruto} | {ok: false, motivo: string, mensagem: string}>}
 */
export async function consultarCnpj(cnpj, { fetchImpl = null } = {}) {
  const digitos = soDigitosCnpj(cnpj);
  if (digitos.length !== 14) {
    return { ok: false, motivo: "cnpj_incompleto", mensagem: "Informe os 14 dígitos do CNPJ." };
  }

  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) {
    return { ok: false, motivo: "sem_fetch", mensagem: "Consulta indisponível neste ambiente." };
  }

  let resposta;
  try {
    resposta = await f(`${BASE}/${digitos}`);
  } catch {
    // Rede corporativa, bloqueador, offline. A escapatória manual é o caminho, não o erro.
    return {
      ok: false,
      motivo: "rede",
      mensagem: "Não conseguimos consultar a Receita agora — confira e preencha à mão.",
    };
  }

  if (resposta.status === 404) {
    return { ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado na base da Receita." };
  }
  if (!resposta.ok) {
    return {
      ok: false,
      motivo: "indisponivel",
      mensagem: "Não conseguimos consultar a Receita agora — confira e preencha à mão.",
    };
  }

  let data;
  try {
    data = await resposta.json();
  } catch {
    return {
      ok: false,
      motivo: "resposta_invalida",
      mensagem: "A Receita respondeu em um formato que não conseguimos ler — preencha à mão.",
    };
  }

  return { ok: true, empresa: mapearParaOnboarding(data), situacao: situacaoCadastral(data), bruto: data };
}

/**
 * O recorte que o ONBOARDING usa. Só os campos que a ficha pergunta — o resto (endereço, CNAEs
 * secundários, capital) é do modal de CONVERSÃO, que preenche o formulário da empresa.
 */
export function mapearParaOnboarding(data) {
  return {
    razaoSocial: String(data?.razao_social || "").trim(),
    nomeFantasia: String(data?.nome_fantasia || "").trim(),
    telefone: [data?.ddd_telefone_1, data?.ddd_telefone_2].filter(Boolean).join(" / "),
    dataAbertura: String(data?.data_inicio_atividade || "").trim(),
    porte: porteDaBrasilApi(data),
    naturezaJuridica: String(data?.codigo_natureza_juridica || data?.natureza_juridica || "").trim(),
    municipio: String(data?.municipio || "").trim(),
    uf: String(data?.uf || "").trim().toUpperCase(),
  };
}

/**
 * O recorte que a CONVERSÃO usa: o formulário de `POST /firm/companies` exige endereço COMPLETO e
 * `cnaePrincipal`, e a ficha de onboarding não coleta nenhum dos dois. É por isso que o modal
 * consulta de novo — não por preciosismo.
 */
export function mapearParaFormularioEmpresa(data) {
  const secundarios = Array.isArray(data?.cnaes_secundarios)
    ? data.cnaes_secundarios.map((c) => String(c?.codigo || "").replace(/\D+/g, "")).filter(Boolean)
    : [];
  return {
    razaoSocial: String(data?.razao_social || "").trim(),
    nomeFantasia: String(data?.nome_fantasia || "").trim(),
    telefone: [data?.ddd_telefone_1, data?.ddd_telefone_2].filter(Boolean).join(" / "),
    cnaePrincipal: data?.cnae_fiscal ? String(data.cnae_fiscal) : "",
    cnaesSecundarios: secundarios,
    endereco: {
      rua: [data?.descricao_tipo_de_logradouro, data?.logradouro].filter(Boolean).join(" ").trim(),
      numero: String(data?.numero || "").trim(),
      complemento: String(data?.complemento || "").trim(),
      bairro: String(data?.bairro || "").trim(),
      cidade: String(data?.municipio || "").trim(),
      uf: String(data?.uf || "").trim().toUpperCase(),
      cep: String(data?.cep || "").replace(/\D+/g, ""),
    },
  };
}
