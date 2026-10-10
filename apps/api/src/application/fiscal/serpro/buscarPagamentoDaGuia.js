import { confirmarPagamentoGuia } from "./SerproPaymentConfirmationService.js";

const motivos = {
  already_paid: "A guia já tem confirmação registrada. Confira a origem e os lançamentos antes de consultar novamente.",
  sem_numero_documento: "Guia sem número do documento. Confira a identificação antes de buscar o pagamento.",
  sem_cnpj: "Empresa sem CNPJ para consulta.",
  identificacao_incompleta: "Complete o contrato e a referência da parcela antes de consultar.",
  modalidade_manual: "Esta modalidade de parcelamento exige conferência manual.",
  intervalo_minimo: "A parcela foi consultada recentemente. Aguarde o intervalo antes de uma nova consulta.",
  consulta_em_andamento: "Já existe uma consulta em andamento para esta parcela.",
};

// Mesmo caminho da rotina, sempre sem baixa contábil e sem disparar avisos a clientes.
export async function buscarPagamentoDaGuia(options) {
  const r = await confirmarPagamentoGuia(options);
  if (r.skipped) return { ok: r.ok, encontrado: false, motivo: motivos[r.skipped] || "Consulta não realizada. Confira os dados da guia.", status: r.skipped };
  const c = r.comprovante;
  return { ok: r.ok, encontrado: Boolean(r.pago), status: r.status,
    motivo: r.motivo || r.mensagem || (r.pago ? null : "Pagamento ainda não localizado no SERPRO."),
    comprovantePdfFileId: r.comprovantePdfFileId || null,
    comprovante: c ? { dataArrecadacao: c.dataArrecadacaoBR || c.dataArrecadacao || null,
      principal: c.principal, juros: c.juros, multa: c.multa, total: c.total,
      meioPagamento: c.meioPagamento, confiavel: c.confiavel } : null };
}
