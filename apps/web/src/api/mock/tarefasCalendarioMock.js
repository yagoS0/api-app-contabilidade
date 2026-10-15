import { normalizarTarefaCalendario, expandirTarefaCalendario, aplicarAcaoTarefaCalendario } from '../../../../../packages/shared/src/tarefasCalendario.js';

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
      if(dados.alteracoes?.empresasIds){const ids=new Set(empresas.map(e=>e.companyId||e.id||e.portalClientId));if(dados.alteracoes.empresasIds.some(i=>!ids.has(i)))throw new Error('Empresa não encontrada na sua carteira.');}
      Object.assign(tarefa,aplicarAcaoTarefaCalendario(tarefa,dados));
      return {ok:true,tarefa};
    },
  };
}
