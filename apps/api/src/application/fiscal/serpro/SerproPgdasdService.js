import { normalizeCompetencia } from "../../guides/guideContract.js";
import { SerproHttpClient } from "./SerproHttpClient.js";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

export class SerproPgdasdService {
  constructor(options = {}) {
    this.client = options.client || new SerproHttpClient();
  }

  async emitirDasCobranca({ contratanteCnpj, contribuinteCnpj, periodoApuracao }) {
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
        idServico: "GERARDASCOBRANCA17",
        versaoSistema: "1.0",
        dados: JSON.stringify({ periodoApuracao: competencia.replace("-", "") }),
      },
    };

    return this.client.post("/Emitir", payload);
  }
}
