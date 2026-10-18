import { normalizarTarefaCalendario, expandirTarefaCalendario, aplicarAcaoTarefaCalendario, encontrarTarefaCalendario } from '../../../../../packages/shared/src/tarefasCalendario.js';

export function criarMockTarefasCalendario(empresas = []) {
  const tarefas = [];
  const nomes = () => Object.fromEntries(empresas.map(e => [e.companyId || e.id || e.portalClientId, e.razao || e.razaoSocial || e.nome || e.name]));
  return {
    async listarTarefasCalendario({ inicio, fim, companyId } = {}) {
      const ativas = tarefas.filter(t => !t.excluidaEm);
      return { ok:true, tarefas:ativas, itens:ativas.flatMap(t => expandirTarefaCalendario({...t,nomesEmpresas:nomes()},inicio,fim)).filter(i => !companyId || i.empresasIds.includes(companyId)) };
    },
    async criarTarefaCalendario(dados) {
      const entrada = normalizarTarefaCalendario(dados);
      const ids = new Set(empresas.map(e => e.companyId || e.id || e.portalClientId));
      if (entrada.empresasIds.some(id => !ids.has(id))) throw new Error('Empresa não encontrada na sua carteira.');
      const tarefa = { ...entrada, id:crypto.randomUUID(), userId:'mock', estados:{}, versoes:[], createdAt:new Date().toISOString() };
      tarefas.push(tarefa);
      return { ok:true, tarefa };
    },
    async acaoTarefaCalendario(id,dados) {
      const tarefa=tarefas.find(t => t.id===id && !t.excluidaEm);
      if(!tarefa)throw new Error('Tarefa não encontrada.');
      if(dados.acao==='DUPLICAR'){
        if(!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(dados.intencaoId||''))throw new Error('Identifique a tentativa de duplicação.');
        const copiaId=`copia:${id}:${dados.cicloChave}:${dados.intencaoId}`;
        const existente=tarefas.find(t=>t.id===copiaId);
        if(existente){if(existente.excluidaEm||Object.values(existente.estados||{}).some(s=>s.canceladaEm))throw Object.assign(new Error('A cópia desta tentativa foi excluída. Você pode iniciar uma nova duplicação; a cópia anterior continuará excluída.'),{status:409,code:'CALENDAR_COPY_DELETED'});return {ok:true,tarefa:existente};}
        const oc=encontrarTarefaCalendario(tarefa,dados.cicloChave);
        if(!oc)throw new Error('Ocorrência não encontrada.');
        const copia={...normalizarTarefaCalendario({titulo:`${oc.titulo.slice(0,192)} (cópia)`,descricao:oc.descricao,empresasIds:oc.empresasIds,
          subtarefas:oc.subtarefas.map(s=>({id:crypto.randomUUID(),titulo:s.titulo})),
          config:{...oc.config,recorrencia:'AVULSA',repetirAte:null,repetirQuantidade:null,dataVencimento:oc.dataVencimento}}),
          id:copiaId,userId:'mock',estados:{},versoes:[],createdAt:new Date().toISOString()};
        tarefas.push(copia);return {ok:true,tarefa:copia};
      }
      if(dados.alteracoes?.empresasIds){const ids=new Set(empresas.map(e=>e.companyId||e.id||e.portalClientId));if(dados.alteracoes.empresasIds.some(i=>!ids.has(i)))throw new Error('Empresa não encontrada na sua carteira.');}
      Object.assign(tarefa,aplicarAcaoTarefaCalendario(tarefa,dados));
      return {ok:true,tarefa};
    },
  };
}
