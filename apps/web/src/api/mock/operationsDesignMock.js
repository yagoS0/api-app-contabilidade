// Local presentation adapter: it never performs or simulates successful external actions.
export function operationsDesignMock(guidesByCompany) {
  return {
    async getOperationsTransmissionDocuments(companyId, competencia) { return {ok:true,companyId,competencia,items:[],unavailable:[],confirmation:null}; },
    async getOperationsGuideEvidence(companyId,competencia,offset=0) {
      const all=(guidesByCompany.get(companyId)||[]).filter(g=>g.competencia===competencia);
      return {ok:true,companyId,competencia,items:all.slice(offset,offset+50).map(g=>({companyId,competencia,guideId:g.guideId,revisao:g.versaoPagamento||null,estadoDocumental:g.status,tipo:g.tipo,valor:g.valor,pagamento:{status:g.paymentStatus,origem:g.paymentStatusSource,dataCivil:null,registradoEm:g.paymentConfirmedAt||null,valorPago:null,estadoBaixa:g.confirmacaoCliente?.estadoBaixa||null},envios:g.envio?.canais||[],tentativas:[],historicoLimitado:false})),nextOffset:offset+50<all.length?offset+50:null};
    },
    async previewOperationsGuideSend() { return {ok:false,message:'Ambiente demonstrativo: envio externo não disponível.'}; },
    async downloadOperationsTransmissionDocuments() { throw Error('Nenhum documento vinculado disponível nesta demonstração.'); },
  };
}
