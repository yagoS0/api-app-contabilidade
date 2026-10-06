import { ETAPAS_CARTEIRA } from './fluxoCarteira.js';
const erro = (message, status = 400) => Object.assign(new Error(message), { status });
export function validarEdicaoTarefa(corpo, tarefa, detalhe) {
  if (!corpo || !Number.isInteger(corpo.versao) || corpo.versao !== (tarefa?.versao || 0)) throw erro('A tarefa mudou. Atualize antes de salvar.', 409);
  const acao = corpo.acao || 'planejar';
  if (!['planejar', 'concluir', 'reabrir'].includes(acao)) throw erro('Ação desconhecida.');
  const dados = { ...(tarefa?.dados || {}) };
  if (acao === 'planejar') {
    for (const k of ['responsavel', 'observacao', 'titulo']) if (corpo[k] !== undefined) {
      if (typeof corpo[k] !== 'string' || corpo[k].length > (k === 'observacao' ? 2000 : 160)) throw erro('Texto inválido ou muito longo.');
      dados[k] = corpo[k].trim();
    }
    for (const k of ['dataInicio', 'dataFim']) if (corpo[k] !== undefined) {
      const d = corpo[k];
      if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0,10) !== d)) throw erro('Informe uma data válida.');
      dados[k] = d || null;
    }
    if (Boolean(dados.dataInicio) !== Boolean(dados.dataFim) || dados.dataInicio > dados.dataFim) throw erro('Preencha início e fim na ordem correta.');
    if (corpo.etapa !== undefined) {
      if (!ETAPAS_CARTEIRA.slice(0,-1).includes(corpo.etapa)) throw erro('Etapa inválida.');
      dados.etapa = corpo.etapa;
    }
    return dados;
  }
  if (tarefa.automatica) throw erro('Esta tarefa acompanha o registro da operação. Abra a empresa para executá-la.');
  if (acao === 'reabrir') { delete dados.conclusao; delete dados.importacoes; return dados; }
  if (typeof corpo.evidencia !== 'string' || corpo.evidencia.trim().length < 8 || corpo.evidencia.length > 2000) throw erro('Descreva a conferência, documento ou recibo que comprova a conclusão.');
  if (tarefa.aguardando?.length) throw erro('Conclua as etapas necessárias antes de registrar esta conclusão.');
  if (tarefa.hash && corpo.hash !== tarefa.hash) throw erro('Os dados mudaram desde a conferência. Atualize a tarefa.', 409);
  if (tarefa.chave === 'obrigacoes' && detalhe.fluxo.obrigacoes.some(o => !o.concluida && o.verificador !== 'MES_FECHADO')) throw erro('Há obrigações cadastradas pendentes. Conclua-as na agenda.');
  if (tarefa.chave === 'importar') {
    if (detalhe.fluxo.contabilizacao.chave === 'aberto') throw erro('Feche a competência antes de confirmar a importação.');
    if (!Array.isArray(corpo.entryIds) || !corpo.entryIds.length || corpo.entryIds.length > 5000 || new Set(corpo.entryIds).size !== corpo.entryIds.length) throw erro('Selecione os lançamentos importados no ERP.');
    const selecionados = corpo.entryIds.map(id => detalhe.lancamentos.find(e => e.id === id));
    if (selecionados.some(e => !e?.importavel)) throw erro('A seleção contém lançamentos não exportados ou de outra competência.');
    dados.importacoes = { ...(dados.importacoes || {}) };
    for (const e of selecionados) dados.importacoes[e.id] = { hash: e.hash };
  }
  dados.conclusao = { hash: tarefa.hash, evidencia: corpo.evidencia.trim() };
  return dados;
}

