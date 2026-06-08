import { normalizeCompetencia } from "../../guides/guideContract.js";
import { SerproHttpClient } from "./SerproHttpClient.js";

export const SERPRO_PGDASD_SERVICE_NORMAL = "GERARDAS12";
export const SERPRO_PGDASD_SERVICE_COBRANCA = "GERARDASCOBRANCA17";
export const SERPRO_PGDASD_SERVICE_CONSDECLARACAO = "CONSDECLARACAO13";
// Q12.C.5: Transmitir declaração PGDAS-D (substitui o ato manual no portal).
// idServico oficial do catálogo Integra Contador SERPRO.
// Ref: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/
export const SERPRO_PGDASD_SERVICE_TRANSDECLARACAO = "TRANSDECLARACAO11";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

export class SerproPgdasdService {
  constructor(options = {}) {
    this.client = options.client || new SerproHttpClient();
  }

  async emitirDas({ contratanteCnpj, contribuinteCnpj, periodoApuracao, dataConsolidacao, idServico }) {
    const competencia = normalizeCompetencia(periodoApuracao);
    if (!competencia) {
      const err = new Error("periodo_apuracao_invalido");
      err.code = "SERPRO_INVALID_COMPETENCIA";
      throw err;
    }

    const contratante = onlyDigits(contratanteCnpj);
    const contribuinte = onlyDigits(contribuinteCnpj);
    if (!contratante || contratante.length !== 14) {
      const err = new Error("contratante_cnpj_invalido");
      err.code = "SERPRO_INVALID_CONTRATANTE_CNPJ";
      throw err;
    }
    if (!contribuinte || contribuinte.length !== 14) {
      const err = new Error("contribuinte_cnpj_invalido");
      err.code = "SERPRO_INVALID_CONTRIBUINTE_CNPJ";
      throw err;
    }

    const payload = {
      contratante: { numero: contratante, tipo: 2 },
      autorPedidoDados: { numero: contratante, tipo: 2 },
      contribuinte: { numero: contribuinte, tipo: 2 },
      pedidoDados: {
        idSistema: "PGDASD",
        idServico: String(idServico || SERPRO_PGDASD_SERVICE_NORMAL),
        versaoSistema: "1.0",
        dados: JSON.stringify({
          periodoApuracao: competencia.replace("-", ""),
          ...(dataConsolidacao ? { dataConsolidacao: String(dataConsolidacao) } : {}),
        }),
      },
    };

    return this.client.post("/Emitir", payload);
  }

  async emitirDasNormal(params) {
    return this.emitirDas({
      ...params,
      idServico: SERPRO_PGDASD_SERVICE_NORMAL,
    });
  }

  async emitirDasCobranca(params) {
    return this.emitirDas({
      ...params,
      idServico: SERPRO_PGDASD_SERVICE_COBRANCA,
    });
  }

  /**
   * Q12.C.5: Transmite a declaração PGDAS-D ao SERPRO.
   *
   * ATENÇÃO — esse método ENVIA declaração oficial. Após sucesso, gera DAS
   * cobrável e qualquer correção vira retificação ou MAED. Use só após
   * Apuracao em estado "revisada" pelo contador.
   *
   * @param {Object} opts
   * @param {string} opts.contratanteCnpj  — CNPJ do escritório
   * @param {string} opts.contribuinteCnpj — CNPJ da empresa cliente
   * @param {string} opts.periodoApuracao  — YYYY-MM
   * @param {Object} opts.declaracao       — payload PGDAS-D (estabelecimentos[], etc)
   * @returns {Promise<{dadosSaida: string, mensagens?: any[]}>}
   *          dadosSaida é JSON string com numeroDeclaracao, recibo, dasValor
   */
  async transmitirDeclaracao({ contratanteCnpj, contribuinteCnpj, periodoApuracao, declaracao }) {
    const competencia = normalizeCompetencia(periodoApuracao);
    if (!competencia) {
      const err = new Error("periodo_apuracao_invalido");
      err.code = "SERPRO_INVALID_COMPETENCIA";
      throw err;
    }
    const contratante = onlyDigits(contratanteCnpj);
    const contribuinte = onlyDigits(contribuinteCnpj);
    if (contratante.length !== 14) {
      const err = new Error("contratante_cnpj_invalido");
      err.code = "SERPRO_INVALID_CONTRATANTE_CNPJ";
      throw err;
    }
    if (contribuinte.length !== 14) {
      const err = new Error("contribuinte_cnpj_invalido");
      err.code = "SERPRO_INVALID_CONTRIBUINTE_CNPJ";
      throw err;
    }
    if (!declaracao || typeof declaracao !== "object") {
      const err = new Error("declaracao_invalida");
      err.code = "SERPRO_INVALID_DECLARACAO";
      throw err;
    }

    // O SERPRO espera o JSON da declaração serializado dentro de pedidoDados.dados
    // (string JSON dentro de outro JSON — quirk do Integra Contador).
    const declaracaoStr = JSON.stringify(declaracao);

    return this.client.post("/Declarar", {
      contratante: { numero: contratante, tipo: 2 },
      autorPedidoDados: { numero: contratante, tipo: 2 },
      contribuinte: { numero: contribuinte, tipo: 2 },
      pedidoDados: {
        idSistema: "PGDASD",
        idServico: SERPRO_PGDASD_SERVICE_TRANSDECLARACAO,
        versaoSistema: "1.0",
        dados: declaracaoStr,
      },
    });
  }

  async consultarDeclaracaoIndice({ contratanteCnpj, contribuinteCnpj, periodoApuracao }) {
    const competencia = normalizeCompetencia(periodoApuracao);
    if (!competencia) {
      const err = new Error("periodo_apuracao_invalido");
      err.code = "SERPRO_INVALID_COMPETENCIA";
      throw err;
    }

    const contratante = onlyDigits(contratanteCnpj);
    const contribuinte = onlyDigits(contribuinteCnpj);
    if (!contratante || contratante.length !== 14) {
      const err = new Error("contratante_cnpj_invalido");
      err.code = "SERPRO_INVALID_CONTRATANTE_CNPJ";
      throw err;
    }
    if (!contribuinte || contribuinte.length !== 14) {
      const err = new Error("contribuinte_cnpj_invalido");
      err.code = "SERPRO_INVALID_CONTRIBUINTE_CNPJ";
      throw err;
    }

    return this.client.post("/Consultar", {
      contratante: { numero: contratante, tipo: 2 },
      autorPedidoDados: { numero: contratante, tipo: 2 },
      contribuinte: { numero: contribuinte, tipo: 2 },
      pedidoDados: {
        idSistema: "PGDASD",
        idServico: SERPRO_PGDASD_SERVICE_CONSDECLARACAO,
        versaoSistema: "1.0",
        dados: JSON.stringify({ periodoApuracao: competencia.replace("-", "") }),
      },
    });
  }

}
