// Consulta postal auxiliar; não grava cadastro nem executa emissão.
// Fonte oficial: https://viacep.com.br/ (consultada em 09/09/2026).
// GET /ws/{8 dígitos}/json/ retorna cep, logradouro, bairro, localidade, uf e ibge;
// CEP inexistente retorna { erro: true }. Não há número de imóvel nessa consulta.
// O "complemento" postal pode descrever o trecho da rua: não é complemento do tomador.

import { CAMPOS_ENDERECO_EXIGIDOS, codigoMunicipioVerificado } from "./consultaTomador.js";

export const VIACEP_BASE = "https://viacep.com.br/ws";
export const TIMEOUT_MS = 8000;
export const MOTIVOS = Object.freeze({
  CEP_INVALIDO: "cep_invalido",
  SEM_FETCH: "sem_fetch",
  REDE: "rede",
  TIMEOUT: "timeout",
  NAO_ENCONTRADO: "nao_encontrado",
  INDISPONIVEL: "indisponivel",
  RESPOSTA_INVALIDA: "resposta_invalida",
});

const texto = (valor) => typeof valor === "string" ? valor.trim() || null : null;

function normalizarCep(valor) {
  const cep = texto(valor);
  // Não apagar letras ou outros caracteres para transformar uma entrada inválida em CEP.
  return cep && /^\d{5}-?\d{3}$/.test(cep) ? cep.replace("-", "") : null;
}

function falha(motivo, mensagem, cep) {
  return { ok: false, motivo, mensagem, cep };
}

/**
 * @param {string} cep CEP com oito dígitos; hífen e espaços nas extremidades são aceitos.
 * @param {{fetchImpl?: Function, municipios?: Array, timeoutMs?: number, log?: object}} opcoes
 * @returns {Promise<object>} Sucesso traz `endereco` PARCIAL, com `nro`/`xCpl` nulos.
 * `cMun` só existe quando código, município e UF conferem com a lista oficial fornecida.
 * Falhas de consulta são resultados, para permitir preenchimento manual pelo cliente.
 */
export async function consultarCep(cep, { fetchImpl = null, municipios = null, timeoutMs = TIMEOUT_MS, log = null } = {}) {
  const codigo = normalizarCep(cep);
  if (!codigo) return falha(MOTIVOS.CEP_INVALIDO, "Informe o CEP com 8 dígitos.", null);
  const buscar = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (typeof buscar !== "function") return falha(MOTIVOS.SEM_FETCH, "A consulta de CEP está indisponível neste servidor.", codigo);

  const abortador = new AbortController();
  const prazo = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : TIMEOUT_MS;
  const inicio = Date.now();
  let etapa = "fetch";
  let status = null;
  let relogio;
  // O mesmo prazo cobre os cabeçalhos E o JSON. A corrida também encerra um transporte
  // injetado que não respeite AbortSignal; abort() cancela a conexão no fetch nativo.
  const limite = new Promise((_, reject) => {
    relogio = setTimeout(() => {
      abortador.abort();
      reject(Object.assign(new Error("Consulta de CEP excedeu o prazo."), { name: "AbortError" }));
    }, prazo);
  });

  let resultado;
  try {
    resultado = await Promise.race([
      limite,
      (async () => {
        const resposta = await buscar(`${VIACEP_BASE}/${codigo}/json/`, {
          method: "GET", signal: abortador.signal, headers: { Accept: "application/json" }, redirect: "error",
        });
        status = Number(resposta?.status ?? 0);
        if (status === 404) return falha(MOTIVOS.NAO_ENCONTRADO, "CEP não encontrado na base do ViaCEP.", codigo);
        if (!resposta?.ok) return falha(MOTIVOS.INDISPONIVEL, "Não conseguimos consultar o CEP agora. Os dados podem ser informados manualmente.", codigo);
        etapa = "body";
        const bruto = await resposta.json();
        if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
          return falha(MOTIVOS.RESPOSTA_INVALIDA, "A consulta de CEP retornou dados que não conseguimos conferir.", codigo);
        }
        if (bruto.erro === true || bruto.erro === "true") return falha(MOTIVOS.NAO_ENCONTRADO, "CEP não encontrado na base do ViaCEP.", codigo);
        // Não oferecer endereço de outro CEP, nem aceitar um resultado sem identificação.
        if (normalizarCep(bruto.cep) !== codigo) {
          return falha(MOTIVOS.RESPOSTA_INVALIDA, "O CEP da resposta não corresponde ao informado. Confira os dados manualmente.", codigo);
        }

        const municipioTexto = texto(bruto.localidade);
        const uf = texto(bruto.uf)?.toUpperCase() || null;
        const ibge = typeof bruto.ibge === "string" && /^\d{7}$/.test(bruto.ibge) ? bruto.ibge : null;
        const municipio = codigoMunicipioVerificado({ codigo_municipio_ibge: ibge, municipio: municipioTexto, uf }, municipios);
        const endereco = {
          CEP: codigo, cMun: municipio.codigo, xLgr: texto(bruto.logradouro), xBairro: texto(bruto.bairro),
          nro: null, xCpl: null,
        };
        return {
          ok: true, fonte: "VIACEP", cep: codigo, endereco,
          enderecoFaltantes: CAMPOS_ENDERECO_EXIGIDOS.filter(([campo]) => !endereco[campo]).map(([, rotulo]) => rotulo),
          motivoMunicipio: municipio.motivo, municipioTexto, uf,
        };
      })(),
    ]);
  } catch (err) {
    const timeout = abortador.signal.aborted || err?.name === "AbortError";
    resultado = timeout
      ? falha(MOTIVOS.TIMEOUT, "A consulta de CEP demorou demais. Os dados podem ser informados manualmente.", codigo)
      : etapa === "body"
        ? falha(MOTIVOS.RESPOSTA_INVALIDA, "A consulta de CEP retornou uma resposta que não conseguimos ler.", codigo)
        : falha(MOTIVOS.REDE, "Não conseguimos consultar o CEP agora. Os dados podem ser informados manualmente.", codigo);
  } finally {
    clearTimeout(relogio);
  }

  // Só metadados operacionais: nenhum CEP, endereço ou corpo recebido vai para o log.
  try {
    log?.[resultado.ok ? "info" : "warn"]?.({ ok: resultado.ok, motivo: resultado.motivo || null, status, duracaoMs: Date.now() - inicio }, "consulta auxiliar de CEP no ViaCEP");
  } catch { /* Falha do logger não impede preenchimento manual. */ }
  return resultado;
}
