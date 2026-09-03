// CONSULTA DE CNPJ NA BRASILAPI — do lado do SERVIDOR. A CHAMADA, sem regra.
//
// Até 02/09/2026 esta consulta só existia no NAVEGADOR (`apps/portal-cliente-web/src/api/real/brasilApi.js`
// e o irmão do onboarding no `apps/web`). O assistente de WhatsApp precisa completar o tomador sem
// navegador — e é por isso que ela passou a existir aqui. Decisão do dono, 02/09/2026: "sim, pelo
// servidor" — BrasilAPI (gratuita), "ajuda, nunca portão", CPF nunca.
//
// ── O QUE ESTE MÓDULO GARANTE ────────────────────────────────────────────────────────────────────
//   · NUNCA LANÇA. Devolve `{ ok:false, motivo, mensagem }` em toda falha (rede, timeout, 404, 5xx,
//     corpo torto). Quem chama decide o que fazer — e a resposta certa é sempre "a emissão segue".
//   · `fetch` INJETÁVEL, timeout por `AbortController` (8 s), sem cache, sem gravação.
//   · CPF não sai: 11 dígitos devolvem `{ ok:false, motivo:"cpf" }` sem chamada nenhuma.
//   · Log SEM PII: o CNPJ sai mascarado (`12.345.678/****-**`), nunca a razão social nem o endereço.
//   · A REGRA (o que se aceita da resposta) mora em `consultaTomador.js`, pura, e é amarrada por
//     teste às cópias dos portais.
//
// FONTE: https://brasilapi.com.br/docs#tag/CNPJ — `GET /api/cnpj/v1/{cnpj}` (consultada em
// 02/09/2026). ⚠ O nome dos campos da resposta (`razao_social`, `codigo_municipio_ibge`, `municipio`,
// `uf`, `cep`, `logradouro`, `numero`, `bairro`, `email`, `descricao_situacao_cadastral`) é o que os
// portais já leem em produção desde 19/08/2026; a aceitação do município passa pela prova tripla
// justamente porque a forma não é contrato assinado.

import { log as logPadrao } from "../../config.js";
import { decidirConsulta, NAO_CONSULTA, tomadorDaReceita } from "./consultaTomador.js";

export const BRASILAPI_CNPJ_BASE = "https://brasilapi.com.br/api/cnpj/v1";
export const TIMEOUT_MS = 8000;

export const MOTIVOS = Object.freeze({
  CPF: "cpf",
  CNPJ_INCOMPLETO: "cnpj_incompleto",
  SEM_FETCH: "sem_fetch",
  REDE: "rede",
  TIMEOUT: "timeout",
  NAO_ENCONTRADO: "nao_encontrado",
  INDISPONIVEL: "indisponivel",
  RESPOSTA_INVALIDA: "resposta_invalida",
});

export function mascararCnpj(digitos) {
  const d = String(digitos || "").replace(/\D+/g, "");
  if (d.length !== 14) return "(cnpj fora de forma)";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
}

/**
 * @param {string} cnpj
 * @param {object} [opcoes]
 * @param {Function} [opcoes.fetchImpl]  ⚠ o ponto de injeção — nenhum teste toca a rede
 * @param {Array} [opcoes.municipios]  a lista oficial do IBGE (`carregarMunicipiosIbge`), para a prova do `cMun`
 * @param {number} [opcoes.timeoutMs]
 * @param {object} [opcoes.log]
 * @returns {Promise<{ok:true, cnpj:string, tomador:object, bruto:object}|{ok:false, motivo:string, mensagem:string, cnpj:string|null}>}
 */
export async function consultarCnpj(cnpj, { fetchImpl = null, municipios = null, timeoutMs = TIMEOUT_MS, log = logPadrao } = {}) {
  const decisao = decidirConsulta(cnpj);
  if (!decisao.consultar) {
    if (decisao.motivo === NAO_CONSULTA.CPF) {
      return { ok: false, motivo: MOTIVOS.CPF, mensagem: "CPF não se consulta — preencha os dados do tomador à mão.", cnpj: null };
    }
    return { ok: false, motivo: MOTIVOS.CNPJ_INCOMPLETO, mensagem: "Informe os 14 dígitos do CNPJ.", cnpj: null };
  }
  const digitos = decisao.digitos;
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) {
    return { ok: false, motivo: MOTIVOS.SEM_FETCH, mensagem: "Consulta indisponível neste servidor.", cnpj: digitos };
  }

  const abortador = new AbortController();
  const relogio = setTimeout(() => abortador.abort(), Math.max(1000, Number(timeoutMs) || TIMEOUT_MS));
  const inicio = Date.now();
  let resposta;
  try {
    resposta = await f(`${BRASILAPI_CNPJ_BASE}/${digitos}`, { method: "GET", signal: abortador.signal, headers: { Accept: "application/json" } });
  } catch (causa) {
    clearTimeout(relogio);
    const porTimeout = abortador.signal.aborted || causa?.name === "AbortError";
    log?.warn?.({ cnpj: mascararCnpj(digitos), motivo: porTimeout ? MOTIVOS.TIMEOUT : MOTIVOS.REDE, duracaoMs: Date.now() - inicio }, "consulta de CNPJ na BrasilAPI não saiu");
    return {
      ok: false,
      motivo: porTimeout ? MOTIVOS.TIMEOUT : MOTIVOS.REDE,
      mensagem: porTimeout ? "A Receita demorou demais para responder." : "Não conseguimos consultar a Receita agora.",
      cnpj: digitos,
    };
  } finally {
    clearTimeout(relogio);
  }

  const status = Number(resposta?.status ?? 0);
  if (status === 404) {
    log?.info?.({ cnpj: mascararCnpj(digitos), status, duracaoMs: Date.now() - inicio }, "consulta de CNPJ: não encontrado");
    return { ok: false, motivo: MOTIVOS.NAO_ENCONTRADO, mensagem: "CNPJ não encontrado na base da Receita.", cnpj: digitos };
  }
  if (!resposta?.ok) {
    log?.warn?.({ cnpj: mascararCnpj(digitos), status, duracaoMs: Date.now() - inicio }, "consulta de CNPJ: BrasilAPI indisponível");
    return { ok: false, motivo: MOTIVOS.INDISPONIVEL, mensagem: "Não conseguimos consultar a Receita agora.", cnpj: digitos };
  }
  let bruto;
  try {
    bruto = await resposta.json();
  } catch {
    log?.warn?.({ cnpj: mascararCnpj(digitos), status, duracaoMs: Date.now() - inicio }, "consulta de CNPJ: corpo não é JSON");
    return { ok: false, motivo: MOTIVOS.RESPOSTA_INVALIDA, mensagem: "A Receita respondeu em um formato que não conseguimos ler.", cnpj: digitos };
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, motivo: MOTIVOS.RESPOSTA_INVALIDA, mensagem: "A Receita respondeu em um formato que não conseguimos ler.", cnpj: digitos };
  }

  const tomador = tomadorDaReceita(bruto, { municipios });
  // ⚠ Só o mascarado, o status e a duração — a razão social e o endereço são dados de terceiro.
  log?.info?.({ cnpj: mascararCnpj(digitos), status, duracaoMs: Date.now() - inicio, comEndereco: Boolean(tomador.endereco) }, "consulta de CNPJ na BrasilAPI");
  return { ok: true, cnpj: digitos, tomador, bruto };
}
