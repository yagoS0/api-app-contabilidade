// Q21 (spec v2) — Adapter SERPRO Integra-Parcelamento (implementa o port FornecedorParcelamento).
//
// Contratos por modalidade ficam no mapper. Emissão, descoberta e pagamento são operações
// independentes; somente a antiga prévia contábil exige composição completa.
// A flag de integração continua protegendo chamadas reais.

import { SerproHttpClient } from "./SerproHttpClient.js";
import { INTEGRACAO_SERPRO_PARCELAMENTO } from "../../../config.js";
import {
  mapearParcelamento, mapearParcela, MODALIDADE_SISTEMA,
  mapearEmissaoDasParcela, mapearParcelasGeraveis, emitirDasServico, PARCELAS_GERAVEIS_SERVICO,
  mapearParcelasDisponiveis, mapearPedidosParcelamento, PEDIDOS_SERVICO, OBTER_SERVICO, PAGAMENTO_SERVICO, servicoDaModalidade, parseEnvelope,
} from "./serproParcelamentoMap.js";
import { normalizeParcelamentoDTO, normalizeParcelaDTO } from "../../accounting/parcelamento/contracts.js";
import { reconciliarParcelamento, validarParcela } from "../../accounting/parcelamento/invariantes.js";

export const SERPRO_PARC_SERVICE_OBTER = "OBTERPARC164";
export const SERPRO_PARC_SERVICE_DETPAGTO = "DETPAGTOPARC165";

function onlyDigits(v) { return String(v || "").replace(/\D+/g, ""); }

function flagOff() {
  const err = new Error("Ingestão SERPRO de parcelamento desligada (INTEGRACAO_SERPRO_PARCELAMENTO).");
  err.code = "SERPRO_PARC_FLAG_OFF";
  return err;
}

export class SerproParcelamentoService {
  constructor(options = {}) {
    this.client = options.client || new SerproHttpClient();
    this.log = options.log || null;
  }

  buildEnvelope({ contratanteCnpj, contribuinteCnpj, tipo, idServico, dados }) {
    const contratante = onlyDigits(contratanteCnpj);
    const contribuinte = onlyDigits(contribuinteCnpj);
    const idSistema = servicoDaModalidade(MODALIDADE_SISTEMA, tipo);
    return {
      contratante: { numero: contratante, tipo: 2 },
      autorPedidoDados: { numero: contratante, tipo: 2 },
      contribuinte: { numero: contribuinte, tipo: 2 },
      pedidoDados: {
        idSistema,
        idServico: String(idServico),
        versaoSistema: "1.0",
        dados: dados === "" ? "" : JSON.stringify(dados || {}),
      },
    };
  }

  // OBTERPARC164 → ParcelamentoDTO (consolidado). Valida antes de devolver.
  async consultarParcelamento({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento }) {
    if (!INTEGRACAO_SERPRO_PARCELAMENTO) throw flagOff();
    const payload = this.buildEnvelope({
      contratanteCnpj, contribuinteCnpj, tipo,
      idServico: servicoDaModalidade(OBTER_SERVICO, tipo), dados: { numeroParcelamento: Number(numeroParcelamento) },
    });
    const raw = await this.client.post("/Consultar", payload);
    this.log?.info?.({ servico: SERPRO_PARC_SERVICE_OBTER, numeroParcelamento }, "SERPRO parcelamento: rawPayload recebido");
    const dto = normalizeParcelamentoDTO({ ...mapearParcelamento(raw, { tipo, numeroParcelamento }), tipo, numeroParcelamento, origem: "SERPRO" });
    return { dto, raw };
  }

  // DETPAGTOPARC165 → ParcelaDTO (+ tributos). Valida (Nível 1) antes de devolver.
  async consultarDetalheParcela({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento, numeroParcela, anoMesParcela }) {
    if (!INTEGRACAO_SERPRO_PARCELAMENTO) throw flagOff();
    const payload = this.buildEnvelope({
      contratanteCnpj, contribuinteCnpj, tipo,
      idServico: servicoDaModalidade(PAGAMENTO_SERVICO, tipo), dados: { numeroParcelamento: Number(numeroParcelamento), anoMesParcela: Number(anoMesParcela) },
    });
    const raw = await this.client.post("/Consultar", payload);
    this.log?.info?.({ servico: SERPRO_PARC_SERVICE_DETPAGTO, numeroParcelamento, anoMesParcela }, "SERPRO parcelamento: rawPayload recebido");
    const parcela = normalizeParcelaDTO(mapearParcela(raw, { numeroParcela, anoMesParcela }));
    const val = validarParcela(parcela);
    if (!val.ok) {
      const err = new Error(`Composição SERPRO inválida: ${val.erros.join(" ")}`);
      err.code = "SERPRO_PARC_COMPOSICAO_INVALIDA";
      err.raw = raw;
      throw err;
    }
    return { parcela, raw };
  }

  // PARCELASPARAGERAR172 → competências (AAAAMM) disponíveis para emissão.
  async listarParcelasGeraveis({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento }) {
    if (!INTEGRACAO_SERPRO_PARCELAMENTO) throw flagOff();
    const idServico = PARCELAS_GERAVEIS_SERVICO[String(tipo).toUpperCase()];
    if (!idServico) {
      const err = new Error(`Listagem de parcelas geráveis não suportada para ${tipo} (idServico não confirmado).`);
      err.code = "MODALIDADE_NAO_SUPORTADA";
      throw err;
    }
    const payload = this.buildEnvelope({ contratanteCnpj, contribuinteCnpj, tipo, idServico, dados: "" });
    const raw = await this.client.post("/Consultar", payload);
    this.log?.info?.({ servico: idServico, numeroParcelamento }, "SERPRO parcelamento: parcelas geráveis");
    return { competencias: mapearParcelasGeraveis(raw), parcelas: mapearParcelasDisponiveis(raw), raw };
  }

  // GERARDAS16x → PDF (Buffer) da DAS da parcela. dados: { parcelaParaEmitir: AAAAMM }.
  async emitirDasParcela({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento, anoMesParcela }) {
    if (!INTEGRACAO_SERPRO_PARCELAMENTO) throw flagOff();
    const idServico = emitirDasServico(tipo); // lança MODALIDADE_NAO_SUPORTADA se não confirmado
    const payload = this.buildEnvelope({
      contratanteCnpj, contribuinteCnpj, tipo, idServico,
      dados: { parcelaParaEmitir: Number(String(anoMesParcela).replace(/\D+/g, "")) },
    });
    const raw = await this.client.post("/Emitir", payload);
    this.log?.info?.({ servico: idServico, numeroParcelamento, anoMesParcela }, "SERPRO parcelamento: DAS emitida");
    const { pdfBuffer, numeroDas } = mapearEmissaoDasParcela(raw);
    return { pdfBuffer, numeroDas, raw };
  }

  async listarPedidos({ contratanteCnpj, contribuinteCnpj, tipo }) {
    if (!INTEGRACAO_SERPRO_PARCELAMENTO) throw flagOff();
    const idServico = servicoDaModalidade(PEDIDOS_SERVICO, tipo);
    const raw = await this.client.post("/Consultar", this.buildEnvelope({ contratanteCnpj, contribuinteCnpj, tipo, idServico, dados: "" }));
    return { pedidos: mapearPedidosParcelamento(raw, { tipo }), raw };
  }

  async consultarPagamentoParcela({ contratanteCnpj, contribuinteCnpj, tipo, numeroParcelamento, anoMesParcela }) {
    if (!INTEGRACAO_SERPRO_PARCELAMENTO) throw flagOff();
    const idServico = servicoDaModalidade(PAGAMENTO_SERVICO, tipo);
    const raw = await this.client.post("/Consultar", this.buildEnvelope({ contratanteCnpj, contribuinteCnpj, tipo, idServico, dados: { numeroParcelamento: Number(numeroParcelamento), anoMesParcela: Number(anoMesParcela) } }));
    parseEnvelope(raw, idServico);
    return { raw };
  }
}

// Re-export pra o teste de contrato montar parcelamento completo e reconciliar.
export { reconciliarParcelamento };
