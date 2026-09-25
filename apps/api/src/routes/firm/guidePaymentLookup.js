import { confirmarPagamento } from "../../application/fiscal/serpro/SerproPagtoWebService.js";
import { registrarConsultaPagamentoGuia } from "../../application/guides/ConsultaPagamentoGuiaService.js";
import { comContextoSerpro } from "../../application/fiscal/serpro/serproCallContext.js";
import { getGuideNumeroDocumento } from "../../application/fiscal/serpro/SerproPaymentConfirmationService.js";

const somenteNumeros = value => String(value || "").replace(/\D/g, "");

export function identificacaoConsultaDaGuia(guide) {
  const numeroDocumento = somenteNumeros(getGuideNumeroDocumento(guide));
  const cnpjGuia = somenteNumeros(guide.cnpj);
  const contribuinteCnpj = somenteNumeros(guide.portalClient?.cnpj) || cnpjGuia;
  const motivo = !contribuinteCnpj ? "CNPJ_AUSENTE"
    : contribuinteCnpj.length !== 14 ? "CNPJ_INVALIDO"
      : cnpjGuia && cnpjGuia !== contribuinteCnpj ? "CNPJ_DIVERGENTE" : null;
  return { numeroDocumento, contribuinteCnpj, motivo };
}

export function leituraComprovanteConfirmada(r) {
  return r?.pago === true && r?.resultadoConsulta?.estado === "CONFIRMADO"
    && r.resultadoConsulta.identidadeConferida === true
    && r.resultadoConsulta.cobertura === "COMPLETA";
}

export function mensagemResultadoConsulta(resultado, mensagem) {
  if (resultado?.estado === "NAO_LOCALIZADO") return mensagem || "Pagamento não localizado na Receita até o momento desta consulta.";
  if (resultado?.estado === "PARCIAL_OU_DIVERGENTE") return "O resultado exige conferência: os dados do pagamento estão incompletos ou divergem do documento consultado.";
  if (resultado?.estado === "NAO_APLICAVEL") return "Esta guia não tem identificação suficiente para consultar o pagamento.";
  return "A consulta não permitiu confirmar a situação do pagamento. Confira o resultado antes de orientar o cliente.";
}

// O escopo continua vindo da guarda existente; o snapshot é capturado antes da chamada.
// Registrar a resposta não equivale a aplicá-la: a gravação revalida empresa, documento e versão.
export function createBuscarPagamentoHandler({ getGuideWithFirmAccess, log }) {
  return async (req, res) => {
    const scoped = await getGuideWithFirmAccess({ guideId: req.params?.guideId, user: req.auth.user });
    if (!scoped.guide) return res.status(scoped.status).json({ error: scoped.error });
    const guide = scoped.guide;
    if (guide.status !== "PROCESSED") return res.status(400).json({ error: "guide_not_processed" });
    const { numeroDocumento, contribuinteCnpj, motivo: motivoCnpj } = identificacaoConsultaDaGuia(guide);
    if (!numeroDocumento) {
      return res.json({ ok: true, encontrado: null,
        resultadoConsulta: { estado: "NAO_APLICAVEL", fonte: "PAGTOWEB", consultadoEm: null,
          cobertura: "NAO_CONSULTADA", identidadeConferida: false, numeroDocumento: null, motivo: "SEM_NUMERO_DOCUMENTO" },
        motivo: "Guia sem número de documento — o comprovante é localizado por ele." });
    }
    if (motivoCnpj) {
      return res.json({ ok: true, encontrado: null,
        resultadoConsulta: { estado: "NAO_APLICAVEL", fonte: "PAGTOWEB", consultadoEm: null,
          cobertura: "NAO_CONSULTADA", identidadeConferida: false, numeroDocumento, motivo: motivoCnpj },
        motivo: motivoCnpj === "CNPJ_DIVERGENTE" ? "O CNPJ da guia diverge do cadastro da empresa. Confira antes de consultar."
          : "A empresa está sem CNPJ válido para consultar o pagamento." });
    }
    const consultadoEm = new Date().toISOString();
    let registroIniciado = false;
    try {
      const r = await comContextoSerpro({ origem: "guias:buscar_pagamento", userId: req.auth.user.id },
        () => confirmarPagamento({ contribuinteCnpj, numeroDocumento, logger: log }));
      const resultadoRecebido = r?.resultadoConsulta || { estado: "INDETERMINADO", fonte: "PAGTOWEB",
        consultadoEm, numeroDocumento, motivo: "RESPOSTA_SEM_CLASSIFICACAO", cobertura: "PARCIAL", identidadeConferida: false };
      registroIniciado = true;
      const registro = await registrarConsultaPagamentoGuia({ guide, resultadoConsulta: resultadoRecebido,
        comprovante: leituraComprovanteConfirmada(r) ? r.comprovante : null });
      const resultadoConsulta = registro.resultadoConsulta;
      const encontrado = resultadoConsulta?.estado === "CONFIRMADO" && registro.aplicada
        ? true : resultadoConsulta?.estado === "NAO_LOCALIZADO" ? false : null;
      const c = encontrado ? r.comprovante : null;
      return res.json({ ok: true, encontrado, resultadoConsulta, aplicada: registro.aplicada,
        motivo: encontrado ? null : mensagemResultadoConsulta(resultadoConsulta, r?.mensagem),
        comprovante: c ? { dataArrecadacao: c.dataArrecadacaoBR, principal: c.principal,
          juros: c.juros, multa: c.multa, total: c.total, meioPagamento: c.meioPagamento,
          confiavel: c.confiavel } : null });
    } catch (err) {
      let resultadoConsulta;
      let historicoRegistrado = false;
      // A tentativa falha também deixa observação, mas falha da persistência não inicia
      // uma segunda gravação nem é atribuída à Receita.
      if (!registroIniciado) {
        resultadoConsulta = err?.resultadoConsulta || err?.details?.resultadoConsulta || {
          estado: "INDETERMINADO", fonte: "PAGTOWEB", consultadoEm, numeroDocumento,
          motivo: err?.code || "FALHA_CONSULTA", cobertura: "NAO_CONSULTADA", identidadeConferida: false,
        };
        try {
          const registro = await registrarConsultaPagamentoGuia({ guide, resultadoConsulta });
          resultadoConsulta = registro.resultadoConsulta;
          historicoRegistrado = true;
        } catch (registroErro) {
          log.error({ code: registroErro?.code, guideId: guide.id }, "Falha ao registrar tentativa de consulta de pagamento");
        }
      }
      log.error({ err: err?.message, guideId: guide.id }, "Falha ao buscar pagamento (PAGTOWEB)");
      return res.status(502).json({ ok: false, error: err?.code || "PAGTOWEB_FALHOU", reason: err?.message,
        ...(resultadoConsulta ? { resultadoConsulta } : {}), historicoRegistrado });
    }
  };
}
