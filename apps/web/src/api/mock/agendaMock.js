import { normalizarAgenda, ocorrenciasDaTarefa, encontrarOcorrenciaDaTarefa } from '../../../../../packages/shared/src/agenda.js';
export function criarMockAgenda(obrigacoes, regras) {
  const tarefas = [], ocultos = [];
  return {
    async getTarefasAgenda(inicio, fim) { return { ok:true, tarefas:tarefas.filter(t => !t.excluidaEm), itens:tarefas.filter(t => !t.excluidaEm).flatMap(t => ocorrenciasDaTarefa(t,inicio,fim)), ocultos }; },
    async salvarTarefaAgenda(dados, id) {
      const titulo = String(dados.titulo || '').trim(); if (!titulo) throw new Error('Informe o título.');
      const config = normalizarAgenda(dados.config);
      if (id) {
        const t = tarefas.find(t => t.id === id && !t.excluidaEm); if (!t) throw new Error('Tarefa não encontrada.');
        if (Object.keys(t.estados).length && JSON.stringify(config) !== JSON.stringify(t.config)) throw new Error('Edite a ocorrência no calendário para preservar o histórico desta série.');
        Object.assign(t,{titulo,descricao:dados.descricao,config}); return {ok:true,tarefa:t};
      }
      const tarefa = { id:crypto.randomUUID(), titulo, descricao:dados.descricao, config, estados:{} }; tarefas.push(tarefa); return {ok:true,tarefa};
    },
    async acaoTarefaAgenda(id, {acao,cicloChave,alteracoes}) {
      const t = tarefas.find(t => t.id === id && !t.excluidaEm); if (!t) throw new Error('Tarefa não encontrada.');
      if (acao === 'EXCLUIR_SERIE') t.excluidaEm = new Date().toISOString();
      else {
        const anterior = t.estados[cicloChave] || {}; if (anterior.canceladaEm) throw new Error('Esta ocorrência foi excluída.');
        const oc = encontrarOcorrenciaDaTarefa(t, cicloChave); if (!oc) throw new Error('Ocorrência não encontrada.');
        if (!['CONCLUIR','REABRIR','EXCLUIR','EDITAR'].includes(acao)) throw new Error('Ação inválida.');
        t.estados[cicloChave] = { ...anterior, ...(acao === 'EDITAR' ? {alteracoes:{titulo:oc.titulo,descricao:oc.descricao,...alteracoes,...normalizarAgenda({...oc,...alteracoes,repetirAte:null})}} : acao === 'EXCLUIR' ? {canceladaEm:new Date().toISOString()} : {concluidaEm:acao === 'CONCLUIR' ? new Date().toISOString() : null}) };
      }
      return {ok:true,tarefa:t};
    },
    async excluirOcorrenciasAgenda(ids) {
      const alvos = ids.map(id => { const serie=obrigacoes.find(o => o.ocorrencias.some(oc=>oc.ocorrenciaId === id)); return {serie,oc:serie?.ocorrencias.find(oc=>oc.ocorrenciaId === id)}; });
      if (alvos.some(a=>!a.oc)) throw new Error('Ocorrência não encontrada.');
      for (const {serie,oc} of alvos) { serie.sobrescritaLocal=true; oc.canceladaEm=new Date().toISOString(); }
      return {ok:true,canceladas:alvos.length};
    },
    async excluirSerieAgenda({regraId,obrigacaoId}) {
      const series=obrigacoes.filter(o=>regraId ? o.regraId === regraId : o.obrigacaoId === obrigacaoId);
      if (regraId) { const r=regras.find(r=>r.regraId === regraId); if (r) {r.ativa=false;r.aplicarANovas=false;} }
      for (const s of series) {s.ativa=false;s.sobrescritaLocal=true;s.encerradaAPartirDe='0000-01';for(const oc of s.ocorrencias) oc.canceladaEm=new Date().toISOString();}
      return {ok:true};
    },
    async editarOcorrenciasAgenda(ids, dados) {
      if(!dados || typeof dados!=='object' || Array.isArray(dados)) throw new Error('Informe as alterações da agenda.');
      const alvos=[...new Set(ids)].map(id=>{const serie=obrigacoes.find(o=>o.ocorrencias.some(oc=>oc.ocorrenciaId===id));return {serie,oc:serie?.ocorrencias.find(oc=>oc.ocorrenciaId===id)};});
      if(alvos.some(a=>!a.oc || a.oc.canceladaEm || a.oc.foraDaRecorrencia)) throw new Error('Esta ocorrência não está mais disponível no calendário.');
      const alteracoes=alvos.map(({serie,oc})=>{
        const anterior={...serie.agendaConfig,...oc.agendaConfig};
        const config=normalizarAgenda({...anterior,dataInicio:oc.dataInicio || oc.dataVencimento,dataFim:oc.dataFim || oc.dataVencimento,...dados,repetirAte:null});
        const titulo=String(Object.hasOwn(dados,'titulo')?dados.titulo??'':anterior.titulo??serie.nome??'').trim();
        if(!titulo || titulo.length>200) throw new Error('Informe um título de até 200 caracteres.');
        const descricao=String((Object.hasOwn(dados,'descricao')?dados.descricao:anterior.descricao??serie.descricao)??'').slice(0,10000);
        return {oc,patch:{dataInicio:config.dataInicio,dataFim:config.dataFim,...(serie.tipo==='TAREFA'?{dataVencimento:config.dataFim}:{}),janelaPersonalizada:true,agendaConfig:{...oc.agendaConfig,horaInicio:config.horaInicio,horaFim:config.horaFim,prioridade:config.prioridade,titulo,descricao}}};
      });
      for(const {oc,patch} of alteracoes) Object.assign(oc,patch);
      return {ok:true};
    },
    async ocultarItemAgenda({tipo,id}) {const chave=`${tipo}|${id}`;if(!ocultos.includes(chave))ocultos.push(chave);return {ok:true};},
  };
}
