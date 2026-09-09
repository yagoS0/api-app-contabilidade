// CONSULTA PÚBLICA DE CNPJ — BrasilAPI, com Minha Receita como alternativa de disponibilidade.
//
// Até 02/09/2026 esta consulta só existia no NAVEGADOR (`apps/portal-cliente-web/src/api/real/brasilApi.js`
// e o irmão do onboarding no `apps/web`). O assistente de WhatsApp precisa completar o tomador sem
// navegador — e é por isso que ela passou a existir aqui. Decisão do dono, 02/09/2026: "sim, pelo
// servidor" — BrasilAPI (gratuita), "ajuda, nunca portão", CPF nunca.
//
// ── O QUE ESTE MÓDULO GARANTE ────────────────────────────────────────────────────────────────────
//   · NUNCA LANÇA. Devolve `{ ok:false, motivo, mensagem }` em toda falha (rede, timeout, 404, 5xx,
//     corpo torto). Quem chama decide o que fazer — e a resposta certa é sempre "a emissão segue".
//   · `fetch` INJETÁVEL, orçamento TOTAL de até 8 s (inclui JSON), sem cache, sem gravação.
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
// Fallback consultado em 09/09/2026: https://docs.minhareceita.org/como-usar/ e
// https://docs.minhareceita.org/dicionario/ — GET /<cnpj>, sem chave; `cnpj` é obrigatório,
// demais dados podem faltar. Serviço comunitário sem SLA; não é uma consulta fiscal privada.

import { log as logPadrao } from "../../config.js";
import { decidirConsulta, NAO_CONSULTA, tomadorDaReceita } from "./consultaTomador.js";

export const BRASILAPI_CNPJ_BASE = "https://brasilapi.com.br/api/cnpj/v1";
export const MINHA_RECEITA_CNPJ_BASE = "https://minhareceita.org";
export const TIMEOUT_MS = 8000;
const FONTES = Object.freeze([
  { id: "BRASILAPI", base: BRASILAPI_CNPJ_BASE },
  { id: "MINHA_RECEITA", base: MINHA_RECEITA_CNPJ_BASE },
]);

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

async function consultarFonte({ fonte, digitos, fetchImpl, municipios, prazoMs }) {
  const abortador = new AbortController();
  let relogio;
  const falha = (motivo, mensagem, fallbackElegivel = false, status = null) => ({ ok: false, motivo, mensagem, fallbackElegivel, status });
  try {
    const limite = new Promise((_, reject) => {
      relogio = setTimeout(() => {
        abortador.abort();
        reject(Object.assign(new Error("Consulta excedeu o prazo."), { name: "AbortError" }));
      }, prazoMs);
    });
    return await Promise.race([limite, (async () => {
      const resposta = await fetchImpl(`${fonte.base}/${digitos}`, { method: "GET", signal: abortador.signal, headers: { Accept: "application/json" } });
      const status = Number(resposta?.status ?? 0);
      if (status === 404) return falha(MOTIVOS.NAO_ENCONTRADO, "CNPJ não encontrado na base pública consultada.", false, status);
      if (!resposta?.ok) return falha(MOTIVOS.INDISPONIVEL, "Não conseguimos consultar os dados públicos do CNPJ agora.", status === 403 || status === 429 || (status >= 500 && status < 600), status);
      let bruto;
      try { bruto = await resposta.json(); }
      catch (causa) {
        if (abortador.signal.aborted || causa?.name === "AbortError") throw causa;
        return falha(MOTIVOS.RESPOSTA_INVALIDA, "A base pública respondeu em um formato que não conseguimos ler.", false, status);
      }
      const documento = typeof bruto?.cnpj === "string" ? bruto.cnpj.trim() : "";
      if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)
        || !/^(?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(documento)
        || documento.replace(/\D/g, "") !== digitos) {
        return falha(MOTIVOS.RESPOSTA_INVALIDA, "A resposta da base pública não confirmou o CNPJ solicitado.", false, status);
      }
      return { ok: true, tomador: tomadorDaReceita(bruto, { municipios }), bruto, status };
    })()]);
  } catch (causa) {
    const timeout = abortador.signal.aborted || causa?.name === "AbortError";
    return falha(timeout ? MOTIVOS.TIMEOUT : MOTIVOS.REDE, timeout ? "A consulta dos dados públicos demorou demais para responder." : "Não conseguimos consultar os dados públicos do CNPJ agora.", true);
  } finally {
    clearTimeout(relogio);
    abortador.abort();
  }
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

  const inicio = Date.now();
  const totalMs = Math.min(TIMEOUT_MS, Math.max(1, Number(timeoutMs) || TIMEOUT_MS));
  const fontesTentadas = [];
  let ultima = { ok: false, motivo: MOTIVOS.TIMEOUT, mensagem: "A consulta dos dados públicos demorou demais para responder." };
  for (const [indice, fonte] of FONTES.entries()) {
    const restante = totalMs - (Date.now() - inicio);
    if (restante <= 0) break;
    fontesTentadas.push(fonte.id);
    // Reservar parte do prazo para a alternativa evita gastar oito segundos em cada provedor.
    const prazoMs = indice === 0 ? Math.min(restante, Math.max(1, Math.floor(totalMs / 2))) : restante;
    const resultado = await consultarFonte({ fonte, digitos, fetchImpl: f, municipios, prazoMs });
    const { fallbackElegivel, status, ...publico } = resultado;
    const registro = { cnpj: mascararCnpj(digitos), fonte: fonte.id, status, motivo: resultado.motivo || null, duracaoMs: Date.now() - inicio };
    if (resultado.ok) log?.info?.({ ...registro, comEndereco: Boolean(resultado.tomador.endereco) }, "consulta pública de CNPJ concluída");
    else log?.warn?.(registro, "consulta pública de CNPJ indisponível");
    ultima = { ...publico, cnpj: digitos, fonte: fonte.id, fontesTentadas: [...fontesTentadas] };
    if (resultado.ok || !fallbackElegivel) return ultima;
  }
  return ultima;
}
