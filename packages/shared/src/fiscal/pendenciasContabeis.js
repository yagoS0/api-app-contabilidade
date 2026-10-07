/** Fechamento é um alerta contábil; nunca afirma uma cobrança da Receita/município. */
export function mesSeguinte(comp, deslocamento = 1) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(comp || ''))) return null;
  const [ano, mes] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  return d.toISOString().slice(0, 7);
}
function dataCivil(valor) {
  if (!valor) return null;
  const s = valor instanceof Date ? valor.toISOString() : String(valor);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
}
export function sinalizarPendenciaFechamento(entry, fechamentos = {}) {
  const vencimento = dataCivil(entry.sourceGuide?.vencimento || entry.vencimento);
  const competenciaPagamento = vencimento?.slice(0, 7) || mesSeguinte(entry.competencia);
  const saldo = Number(entry.saldo ?? entry.valorObrigacao ?? entry.valor ?? entry.totalD ?? 0);
  const pendenciaFechamento = !entry.parcelamentoId && !entry.parcelamentoOrigem && !String(entry.subtipo || '').startsWith('PARC') && !entry.placeholder && entry.origem !== 'TEMPLATE'
    && ['ABERTO', 'PARCIAL'].includes(entry.statusPagamento) && saldo > 0.009
    && Boolean(fechamentos[competenciaPagamento]?.fechadoEm);
  return { ...entry, competenciaPagamento, pendenciaFechamento, fechamentoPagamentoEm: fechamentos[competenciaPagamento]?.fechadoEm || null };
}
export function projetarPendenciasContabeis(entries) {
  return entries.filter(e => e.pendenciaFechamento || e.parcelamentoOrigem).map(e => {
    if(e.parcelamentoOrigem){
      const o=e.parcelamentoOrigem,ativo=o.statusContrato==='ATIVO',quitado=o.statusContrato==='QUITADO';
      return {id:'composicao:'+o.id,entryId:e.id,fonte:'CONTABILIDADE',origem:'CONTABILIDADE',tipo:'PARCELAMENTO',estado:ativo?'PARCELADO':quitado?'PAGO':'A_CONCILIAR',
        titulo:'Dívida incluída em parcelamento',tributo:e.subtipo || e.eventType || 'Tributo',competencia:e.competencia,vencimento:null,
        total:ativo||quitado?Math.round(o.principalIncluido*100):null,saldo:null,situacao:o.legado?'Vínculo antigo: conferir composição':ativo?'Parcelado':quitado?'Quitado no acordo':'A conciliar após encerramento do acordo',
        evidencia:{registro:{Origem:'Contabilidade',Descrição:e.historico || '',Parcelamento:o.numero || o.parcelamentoId,'Principal incluído':o.principalIncluido},anotacoes:{},descricao:['Composição do acordo, sem duplicar o saldo do parcelamento. Em rescisão, o saldo por tributo depende de conciliação dos pagamentos.'],anotacoesBloco:[]}};
    }
    const total = Math.round(Number(e.saldo ?? e.valorObrigacao ?? e.valor ?? e.totalD) * 100);
    return { id: 'contabil:' + e.id, entryId: e.id, fonte: 'CONTABILIDADE', origem: 'CONTABILIDADE', tipo: 'DEBITO', estado: 'VENCIDO',
      titulo: 'Pendência da contabilidade', tributo: e.subtipo || e.eventType || 'Provisão', competencia: e.competencia,
      vencimento: dataCivil(e.sourceGuide?.vencimento || e.vencimento), total, saldo: total,
      situacao: 'Pagamento pendente',
      evidencia: { registro: { Origem: 'Contabilidade', Descrição: e.historico || '', 'Mês previsto do pagamento': e.competenciaPagamento, 'Fechado em': String(e.fechamentoPagamentoEm), 'Lançamento': e.id }, anotacoes: {}, descricao: ['Saldo contábil em aberto no mês de pagamento fechado. Não é resultado de consulta externa.'], anotacoesBloco: [] } };
  });
}

/** Provisões anteriores ao mês do pagamento que possuem uma baixa disponível. */
export function pagamentosDisponiveis(entries, competencia) {
  return entries.filter(e => e.competencia < competencia && !e.placeholder && e.origem !== 'TEMPLATE'
    && !e.parcelamentoId && !e.parcelamentoOrigem && !String(e.subtipo || '').startsWith('PARC')
    && !String(e.id).startsWith('synthetic-das-')
    && ['ABERTO','PARCIAL'].includes(e.statusPagamento)
    && Number(e.saldo ?? e.valorObrigacao ?? e.valor ?? e.totalD ?? 0) > 0.009);
}
