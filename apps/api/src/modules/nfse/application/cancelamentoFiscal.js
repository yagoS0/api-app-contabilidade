import { decidirConfirmacaoFiscalCancelamento } from '../domain/confirmacaoFiscalCancelamento.js';

export function resultadoFiscalNaoConfirmado(situacao = 'INCONCLUSIVO') {
  return Object.assign(new Error(situacao === 'PENDENTE' ? 'Pedido recebido para análise; o cancelamento ainda não foi confirmado.' : situacao === 'INDEFERIDO' ? 'O pedido de cancelamento foi indeferido.' : 'Não foi possível comprovar o cancelamento fiscal. Consulte o resultado antes de qualquer novo pedido.'), {
    code: 'NFSE_CANCELAMENTO_NAO_CONFIRMADO', codigo: 'NFSE_CANCELAMENTO_NAO_CONFIRMADO', camada: 'TRANSPORTE', situacao,
    correcao: 'Confira os eventos da nota. Não repita a transmissão de um pedido com resultado não confirmado.',
  });
}

// A reserva pertence à identidade fiscal, não ao canal. Nenhuma chamada de rede ocorre em tx.
export function criarCancelamentoFiscal({ reservar, registrarResultado, marcarDespacho, registrarFalha, verificarResposta }) {
  return async function cancelar({ contexto, prepararTransporte, revalidarAutorizacao }) {
    if (typeof revalidarAutorizacao !== 'function') throw Object.assign(new Error('Autorização atual do cancelamento não comprovada.'), { code: 'NFSE_CANCELAMENTO_AUTORIZACAO', antesDoPost: true });
    await revalidarAutorizacao();
    const reserva = await reservar(contexto);
    let despachou = false;
    try {
      const transporte = await prepararTransporte();
      await revalidarAutorizacao();
      // Reservas existentes, inclusive incertas, só permitem consulta, nunca novo POST.
      let corpo;
      if (!reserva.nova) {
        corpo = await transporte.consultar();
      } else {
        await marcarDespacho(reserva);
        despachou = true;
        corpo = await transporte.enviar();
      }
      const evidencia = verificarResposta(corpo, contexto);
      let decisao = decidirConfirmacaoFiscalCancelamento(evidencia, contexto);
      const resultado = await registrarResultado(reserva, contexto, evidencia, decisao);
      // Persistência pode detectar conflito com evidências anteriormente custodiadas.
      if (resultado?.decisao) decisao = resultado.decisao;
      const invoice = resultado?.decisao ? resultado.invoice : resultado;
      if (!decisao.cancelada) throw resultadoFiscalNaoConfirmado(decisao.situacao);
      const usados = resultado?.evidencias || evidencia?.evidencias || (evidencia ? [evidencia] : []);
      const eventos = [...new Map(usados.map(e => [e.id + ':' + e.hash, e])).values()]
        .filter(e => decidirConfirmacaoFiscalCancelamento(e, contexto).cancelada)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0);
      return { status: 'cancelled', confirmacaoFiscal: true, situacao: decisao.situacao, nfse: invoice, providerData: eventos.length === 1 ? { eventoId: eventos[0].id, hash: eventos[0].hash } : { eventos: eventos.map(e => ({ eventoId: e.id, hash: e.hash })) } };
    } catch (erro) {
      // Só esta tentativa nova comprova ausência de despacho. Reserva antiga continua incerta.
      if (reserva.nova && !despachou) erro.antesDoPost = true;
      if (erro.code !== 'NFSE_CANCELAMENTO_NAO_CONFIRMADO') {
        try { await registrarFalha(reserva, { incerto: despachou || !reserva.nova, codigo: erro.code || 'FALHA_LOCAL' }); }
        catch { /* A reserva durável anterior continua impedindo novo despacho. Preserva o erro original. */ }
      }
      if (despachou && erro.code !== 'NFSE_CANCELAMENTO_NAO_CONFIRMADO') throw resultadoFiscalNaoConfirmado();
      throw erro;
    }
  };
}
