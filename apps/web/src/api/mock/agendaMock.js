import { normalizarAgenda, ocorrenciasDaTarefa, encontrarOcorrenciaDaTarefa, prepararEdicaoSerieTarefa, ocorrenciasDoEstadoDaTarefa, prepararExclusaoTarefa } from '../../../../../packages/shared/src/agenda.js';
import { excluirDiaDaOcorrencia } from '../../../../../packages/shared/src/agendaDiasOcorrencia.js';
export function criarMockAgenda(obrigacoes, regras, ehFeriado) {
  const tarefas = [], ocultos = [];
  return {
    async getTarefasAgenda(inicio, fim) { return { ok:true, tarefas:tarefas.filter(t => !t.excluidaEm), itens:tarefas.filter(t => !t.excluidaEm).flatMap(t => ocorrenciasDaTarefa(t,inicio,fim,ehFeriado)), ocultos }; },
    async vincularTarefasEmpresas(dados) {
      if (!dados.compartilhar) throw new Error('Confirme a visibilidade para a equipe.');
      const ids=[...new Set(dados.empresasIds || [])];
      if (!ids.length || ids.length>100) throw new Error('Selecione até 100 empresas.');
      const t=dados.tarefaId ? tarefas.find(t=>t.id===dados.tarefaId && !t.excluidaEm) : null;
      if(dados.tarefaId && !t) throw new Error('Tarefa não encontrada.');
      if(t && (Object.keys(t.estados || {}).length || t.config.versoes?.length || t.config.encerradaAPartirDe || t.config.exclusoes?.length)) throw new Error('Esta tarefa já tem histórico. Crie uma nova tarefa vinculada às empresas; o histórico pessoal será preservado.');
      const config=normalizarAgenda(dados.config);
      if(t && (t.config.recorrencia !== 'AVULSA' || config.recorrencia !== 'AVULSA') && t.config.dataInicio < new Date().toISOString().slice(0,10)) throw new Error('Esta série já começou. Crie uma nova tarefa empresarial; as ocorrências pessoais anteriores serão preservadas.');
      if(t && config.dataInicio !== t.config.dataInicio) throw new Error('Para vincular a série inteira, mantenha a data inicial original ou crie uma nova tarefa empresarial.');
      const previa=await this.previewEscopoRegra({escopo:'SELECAO_MANUAL',filtros:{empresasIds:ids}});
      if(previa.total !== ids.length) throw new Error('Uma empresa selecionada não está mais disponível.');
      const inicio=obrigacoes.length;
      const grupoTarefaId=crypto.randomUUID();
      try {
        for(const id of ids) await this.createObrigacao(id,{nome:dados.titulo,descricao:dados.descricao,tipo:'TAREFA',periodicidade:config.recorrencia,agendaConfig:config,dataInicio:config.dataInicio,dataFim:config.dataFim,diaVencimento:Number(config.dataFim.slice(8)),mesReferencia:Number(config.dataInicio.slice(5,7)),ajusteDiaUtil:'MANTER',defasagemMeses:0});
      } catch(e) { obrigacoes.splice(inicio); throw e; }
      for (const tarefa of obrigacoes.slice(inicio)) tarefa.agendaConfig.grupoTarefaId=grupoTarefaId;
      if(t) t.excluidaEm=new Date().toISOString();
      return {ok:true};
    },
    async salvarTarefaAgenda(dados, id) {
      const titulo = String(dados.titulo || '').trim(); if (!titulo) throw new Error('Informe o título.');
      const config = normalizarAgenda(dados.config);
      if (id) {
        const t = tarefas.find(t => t.id === id && !t.excluidaEm); if (!t) throw new Error('Tarefa não encontrada.');
        if ((Object.keys(t.estados).length || t.config.versoes?.length || t.config.encerradaAPartirDe || t.config.exclusoes?.length) && JSON.stringify(config) !== JSON.stringify(normalizarAgenda(t.config))) throw new Error('Edite a ocorrência no calendário para preservar o histórico desta série.');
        Object.assign(t,{titulo,descricao:dados.descricao,config:{...t.config,...config}}); return {ok:true,tarefa:t};
      }
      const tarefa = { id:crypto.randomUUID(), titulo, descricao:dados.descricao, config, estados:{} }; tarefas.push(tarefa); return {ok:true,tarefa};
    },
    async acaoTarefaAgenda(id, {acao,cicloChave,alteracoes,alcance="ESTA"}) {
      const t = tarefas.find(t => t.id === id && !t.excluidaEm); if (!t) throw new Error('Tarefa não encontrada.');
      if (!['ESTA','ESTA_E_PROXIMAS','ESTA_E_ANTERIORES'].includes(alcance)) throw new Error('Alcance inválido.');
      if (acao === 'EXCLUIR_SERIE') t.excluidaEm = new Date().toISOString();
      else {
        const anterior = t.estados[cicloChave] || {}; if (anterior.canceladaEm) throw new Error('Esta ocorrência foi excluída.');
        const oc = encontrarOcorrenciaDaTarefa(t, cicloChave, ehFeriado); if (!oc) throw new Error('Ocorrência não encontrada.');
        if (acao === 'EXCLUIR' && alcance !== 'ESTA') { t.config=prepararExclusaoTarefa(t,cicloChave,alcance,ehFeriado);return {ok:true,tarefa:t}; }
        if (acao === 'EDITAR_SERIE') { Object.assign(t, prepararEdicaoSerieTarefa(t, cicloChave, alteracoes || {}, ehFeriado)); return {ok:true,tarefa:t}; }
        if (!['CONCLUIR','REABRIR','EXCLUIR','EDITAR'].includes(acao)) throw new Error('Ação inválida.');
        t.estados[cicloChave] = { ...anterior, ...(acao === 'EDITAR' ? {alteracoes:{titulo:oc.titulo,descricao:oc.descricao,...alteracoes,...normalizarAgenda({...oc,...alteracoes,repetirAte:null})}} : acao === 'EXCLUIR' ? {canceladaEm:new Date().toISOString()} : {concluidaEm:acao === 'CONCLUIR' ? new Date().toISOString() : null}) };
      }
      return {ok:true,tarefa:t};
    },
    async converterTarefaEmObrigacao(id, {cicloChave,regra}) {
      const t=tarefas.find(t=>t.id===id && !t.excluidaEm); if(!t) throw new Error('Tarefa não encontrada.');
      const selecionada=encontrarOcorrenciaDaTarefa(t,cicloChave,ehFeriado); if(!selecionada) throw new Error('Ocorrência não encontrada.');
      if(!regra?.agendaConfig) throw new Error('Informe a configuração da obrigação.');
      const inicio=prepararEdicaoSerieTarefa(t,cicloChave,regra.agendaConfig,ehFeriado).config.versoes.at(-1).aPartirDe;
      for(const [chave,estado] of Object.entries(t.estados||{})) {
        if(ocorrenciasDoEstadoDaTarefa(t,chave,ehFeriado).some(oc=>(oc.dataFimOriginal || oc.dataFim)>=inicio) && (estado.concluidaEm || estado.canceladaEm || (estado.alteracoes && chave!==cicloChave))) throw new Error('Há ocorrências concluídas, excluídas ou editadas neste período. Escolha uma ocorrência posterior a esse histórico para convertê-la em obrigação.');
      }
      normalizarAgenda(regra.agendaConfig);
      const previa=await this.previewEscopoRegra(regra);
      if(!previa.total) throw new Error('Nenhuma empresa da sua carteira corresponde à seleção.');
      const resultado=await this.createRegraObrigacao({...regra,tipo:'OBRIGACAO'});
      t.config={...t.config,encerradaAPartirDe:inicio};
      return resultado;
    },
    async excluirOcorrenciasAgenda(ids, alcance="ESTA", dia=null) {
      if (!['ESTA','ESTA_E_PROXIMAS','ESTA_E_ANTERIORES'].includes(alcance)) throw new Error('Alcance inválido.');
      const alvos = ids.map(id => { const serie=obrigacoes.find(o => o.ocorrencias.some(oc=>oc.ocorrenciaId === id)); return {serie,oc:serie?.ocorrencias.find(oc=>oc.ocorrenciaId === id)}; });
      if (alvos.some(a=>!a.oc)) throw new Error('Ocorrência não encontrada.');
      for (const {serie,oc} of alvos) {
        serie.sobrescritaLocal=true;
        const ciclo=o=>o.cicloChave || o.dataVencimento.slice(0,7), corte=ciclo(oc);
        if(alcance==='ESTA_E_PROXIMAS') serie.encerradaAPartirDe=[serie.encerradaAPartirDe,corte].filter(Boolean).sort()[0];
        if(alcance==='ESTA_E_ANTERIORES') serie.excluidaAteCiclo=[serie.excluidaAteCiclo,corte].filter(Boolean).sort().at(-1);
        for(const item of serie.ocorrencias) if(alcance==='ESTA' ? item===oc : alcance==='ESTA_E_PROXIMAS' ? ciclo(item)>=corte : ciclo(item)<=corte) {
          if(item===oc && dia) { item.agendaConfig={...item.agendaConfig,diasExcluidos:excluirDiaDaOcorrencia(item,serie,dia,alcance)};item.janelaPersonalizada=true; }
          else item.canceladaEm ||= new Date().toISOString();
        }
      }
      return {ok:true,canceladas:alvos.length};
    },
    async excluirSerieAgenda({regraId,obrigacaoId,grupoTarefaId}) {
      const series=obrigacoes.filter(o=>grupoTarefaId ? o.tipo === 'TAREFA' && o.agendaConfig?.grupoTarefaId === grupoTarefaId : regraId ? o.regraId === regraId : o.obrigacaoId === obrigacaoId);
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
        const agendaConfig={...oc.agendaConfig,horaInicio:config.horaInicio,horaFim:config.horaFim,prioridade:config.prioridade,titulo,descricao};
        const mudouData = config.dataInicio !== oc.dataInicio || config.dataFim !== oc.dataFim;
        if (mudouData) for (const chave of ['diasAgendados','dataInicioOriginal','dataFimOriginal']) delete agendaConfig[chave];
        return {oc,mudouData,patch:{dataInicio:config.dataInicio,dataFim:config.dataFim,...(serie.tipo==='TAREFA'?{dataVencimento:config.dataFim}:{}),janelaPersonalizada:true,agendaConfig}};
      });
      for(const {oc,patch,mudouData} of alteracoes) { Object.assign(oc,patch); if (mudouData) for (const chave of ['diasAgendados','dataInicioOriginal','dataFimOriginal']) delete oc[chave]; }
      return {ok:true};
    },
    async ocultarItemAgenda({tipo,id}) {const chave=`${tipo}|${id}`;if(!ocultos.includes(chave))ocultos.push(chave);return {ok:true};},
  };
}
