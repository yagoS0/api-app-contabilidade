// Consulta de CNPJ na BrasilAPI — a CHAMADA, sem regra.
//
// ⚠ ORIGEM: `apps/web/src/features/onboarding/lib/brasilApi.js` (portal do escritório), de onde
// vieram a classificação da recusa e o tratamento de ausência de `fetch`. O que ficou de fora foi
// de propósito: os mapeamentos `mapearParaOnboarding`/`mapearParaFormularioEmpresa` respondem ao
// CADASTRO da empresa, que não existe deste lado. Aqui a resposta viaja crua (`bruto`) e quem
// decide o que fazer com ela é `features/emitir/lib/consultaTomador.js`.
//
// ⚠ A CHAMADA SAI DO BROWSER, SEM PROXY, e não passa pela API do contador — a BrasilAPI é pública.
// Ela cai com rede corporativa, bloqueador de conteúdo, offline e throttle da própria BrasilAPI.
// O caminho de falha é REQUISITO, não polimento: a tela tem de continuar preenchível à mão. Por
// isso esta função **nunca lança**: devolve `{ ok: false, motivo, mensagem }` e quem chama decide.
//
// ⚠⚠ ELA NÃO É UM `ApiError`, e isso é deliberado. Um erro lançado daqui entraria no
// `real_with_mock_fallback` de `api/index.js` e a falha da BrasilAPI viraria **dados de empresa do
// mock** numa tela que emite nota fiscal de verdade. Recusa é `{ ok: false }`, sempre.
//
// ⚠⚠ A MENSAGEM DIZ O QUE ACONTECEU; O QUE FAZER É DA TELA — e isso é conserto de 19/08/2026, não
// estética. Estas mensagens terminavam em *"— confira e preencha à mão"*, e a `EmitirNotaPage`
// renderiza, logo abaixo, *"Preencha os dados do tomador à mão — a emissão segue normalmente"*: o
// mesmo recado, duas vezes, uma embaixo da outra. Quem apaga uma das duas depois não sabe qual
// delas carregava o "a emissão segue normalmente" — que é a metade que impede o cliente de achar
// que travou. A divisão passou a ser: aqui, o FATO (a consulta não saiu); lá, a SAÍDA. Não
// reintroduza a instrução aqui.

const BASE = "https://brasilapi.com.br/api/cnpj/v1";

export function soDigitosCnpj(valor) {
  return String(valor ?? "").replace(/\D+/g, "").slice(0, 14);
}

/**
 * ⚠ Situação cadastral ≠ ATIVA (BAIXADA / INAPTA / SUSPENSA) muda a conversa inteira, e vem de
 * graça na mesma resposta. Devolvida separada para a tela poder destacá-la — como AVISO.
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
 * @returns {Promise<{ok: true, situacao, bruto} | {ok: false, motivo: string, mensagem: string}>}
 */
export async function consultarCnpjNaBrasilApi(cnpj, { fetchImpl = null } = {}) {
  const digitos = soDigitosCnpj(cnpj);
  if (digitos.length !== 14) {
    return { ok: false, motivo: "cnpj_incompleto", mensagem: "Informe os 14 dígitos do CNPJ." };
  }

  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) {
    return { ok: false, motivo: "sem_fetch", mensagem: "Consulta indisponível neste navegador." };
  }

  let resposta;
  try {
    resposta = await f(`${BASE}/${digitos}`);
  } catch {
    // Rede corporativa, bloqueador, offline. A escapatória manual é o caminho, não o erro.
    return {
      ok: false,
      motivo: "rede",
      mensagem: "Não conseguimos consultar a Receita agora.",
    };
  }

  if (resposta.status === 404) {
    return { ok: false, motivo: "nao_encontrado", mensagem: "CNPJ não encontrado na base da Receita." };
  }
  if (!resposta.ok) {
    return {
      ok: false,
      motivo: "indisponivel",
      mensagem: "Não conseguimos consultar a Receita agora.",
    };
  }

  let data;
  try {
    data = await resposta.json();
  } catch {
    return {
      ok: false,
      motivo: "resposta_invalida",
      mensagem: "A Receita respondeu em um formato que não conseguimos ler.",
    };
  }

  return { ok: true, situacao: situacaoCadastral(data), bruto: data };
}
