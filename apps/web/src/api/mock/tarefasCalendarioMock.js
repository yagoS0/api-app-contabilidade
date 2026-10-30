import { normalizarTarefaCalendario, expandirTarefaCalendario, aplicarAcaoTarefaCalendario, encontrarTarefaCalendario, responsavelPodeVerSerie } from '../../../../../packages/shared/src/tarefasCalendario.js';

// Injectable, instance-local resolved ACL. Negative fixtures can revoke source
// access independently of task access, without importing server code in the web.
export function acessoTarefasMock(empresas, estado) {
  const empresasIds = () => empresas.map(e => e.companyId || e.id || e.portalClientId);
  const usuario = id => (estado.acesso?.usuarios || [
    { id: 'mock', ativo: true, triagem: true, empresasIds: empresasIds() },
    { id: 'mock-contador', ativo: true, triagem: true, empresasIds: empresasIds() },
  ]).find(u => u.id === id && u.ativo);
  const atorId = () => estado.acesso?.atorId || 'mock';
  const ids = t => [...new Set([...(t.empresasIds || []), ...(t.versoes || []).flatMap(v => v.dados?.empresasIds || []), ...Object.values(t.estados || {}).flatMap(s => s.alteracoes?.empresasIds || [])])];
  const origem = (link, id = atorId()) => {
    const u = usuario(id);
    return Boolean(u && (link.empresaOrigemId ? u.empresasIds.includes(link.empresaOrigemId) : u.triagem)
      && (estado.acesso?.podeVerSolicitacao?.(link.solicitacaoId, id) ?? true));
  };
  const tarefa = t => {
    const u = usuario(atorId()), empresas = ids(t);
    return Boolean(u && (empresas.length ? empresas.every(id => u.empresasIds.includes(id)) : t.userId === u.id || responsavelPodeVerSerie(t, u.id)));
  };
  const validar = (t, link = null) => {
    const ator = usuario(atorId());
    if (!ator || ids(t).some(id => !ator.empresasIds.includes(id))) throw new Error('Tarefa não encontrada.');
    if (!t.responsavelId) return;
    const u = usuario(t.responsavelId);
    if (!u || ids(t).some(id => !u.empresasIds.includes(id)) || (link && !origem(link, u.id))) throw new Error('Responsável inválido.');
  };
  return { atorId, origem, tarefa, validar, empresasIds: ids };
}

export function criarMockTarefasCalendario(empresas = [], estado = { tarefas: [], vinculos: new Map() }) {
  const { tarefas, vinculos } = estado;
  const acl = acessoTarefasMock(empresas, estado);
  const dto = t => JSON.parse(JSON.stringify({ ...t, ...(vinculos.has(t.id) && acl.origem(vinculos.get(t.id)) ? { solicitacaoOrigem: { id: vinculos.get(t.id).solicitacaoId, podeAbrir: true } } : {}) }));
  const nomes = () => Object.fromEntries(empresas.map(e => [e.companyId || e.id || e.portalClientId, e.razao || e.razaoSocial || e.nome || e.name]));
  return {
    async listarTarefasCalendario({ inicio, fim, companyId } = {}) {
      const ativas = tarefas.filter(t => !t.excluidaEm && acl.tarefa(t) && (!companyId || acl.empresasIds(t).includes(companyId))).map(dto);
      return { ok:true, tarefas:ativas, itens:ativas.flatMap(t => expandirTarefaCalendario({...t,nomesEmpresas:nomes()},inicio,fim)).filter(i => !companyId || i.empresasIds.includes(companyId)) };
    },
    async obterTarefaCalendario(id, { cicloChave } = {}) {
      const row = tarefas.find(t => t.id === id);
      if (!row || !acl.tarefa(row)) throw new Error('Tarefa não encontrada.');
      const tarefa = dto(row);
      if (cicloChave !== undefined) {
        const estados = { ...row.estados, [cicloChave]: { ...row.estados?.[cicloChave], canceladaEm: null } };
        if (!encontrarTarefaCalendario({ ...row, excluidaEm: null, estados }, cicloChave)) throw new Error('Ocorrência não encontrada.');
        tarefa.ciclo = { chave: cicloChave, estado: row.excluidaEm ? 'EXCLUIDA' : row.estados?.[cicloChave]?.canceladaEm ? 'CANCELADA' : 'ATIVA' };
      }
      return { ok: true, tarefa };
    },
    async criarTarefaCalendario(dados) {
      const entrada = normalizarTarefaCalendario(dados);
      acl.validar(entrada);
      const ids = new Set(empresas.map(e => e.companyId || e.id || e.portalClientId));
      if (entrada.empresasIds.some(id => !ids.has(id))) throw new Error('Empresa não encontrada na sua carteira.');
      const tarefa = { ...entrada, id:crypto.randomUUID(), userId:acl.atorId(), estados:{}, versoes:[], createdAt:new Date().toISOString() };
      tarefas.push(tarefa);
      return { ok:true, tarefa: dto(tarefa) };
    },
    async acaoTarefaCalendario(id,dados) {
      const tarefa=tarefas.find(t => t.id===id && !t.excluidaEm);
      if(!tarefa || !acl.tarefa(tarefa))throw new Error('Tarefa não encontrada.');
      if(dados.acao==='DUPLICAR'){
        if(!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(dados.intencaoId||''))throw new Error('Identifique a tentativa de duplicação.');
        const copiaId=`copia:${acl.atorId()}:${id}:${dados.cicloChave}:${dados.intencaoId}`;
        const existente=tarefas.find(t=>t.id===copiaId);
        if(existente){if(!acl.tarefa(existente))throw new Error('Tarefa não encontrada.');if(existente.excluidaEm||Object.values(existente.estados||{}).some(s=>s.canceladaEm))throw Object.assign(new Error('A cópia desta tentativa foi excluída. Você pode iniciar uma nova duplicação; a cópia anterior continuará excluída.'),{status:409,code:'CALENDAR_COPY_DELETED'});return {ok:true,tarefa:dto(existente)};}
        const oc=encontrarTarefaCalendario(tarefa,dados.cicloChave);
        if(!oc)throw new Error('Ocorrência não encontrada.');
        const copia={...normalizarTarefaCalendario({titulo:`${oc.titulo.slice(0,192)} (cópia)`,descricao:oc.descricao,empresasIds:oc.empresasIds,responsavelId:oc.responsavelId ?? null,
          subtarefas:oc.subtarefas.map(s=>({id:crypto.randomUUID(),titulo:s.titulo})),
          config:{...oc.config,recorrencia:'AVULSA',repetirAte:null,repetirQuantidade:null,dataVencimento:oc.dataVencimento}}),
          id:copiaId,userId:acl.atorId(),estados:{},versoes:[],createdAt:new Date().toISOString()};
        acl.validar(copia);
        tarefas.push(copia);return {ok:true,tarefa:copia};
      }
      if(dados.alteracoes?.empresasIds){const ids=new Set(empresas.map(e=>e.companyId||e.id||e.portalClientId));if(dados.alteracoes.empresasIds.some(i=>!ids.has(i)))throw new Error('Empresa não encontrada na sua carteira.');}
      const link = vinculos.get(id);
      if (link && Object.hasOwn(dados.alteracoes || {}, 'empresasIds')) {
        const ids = dados.alteracoes.empresasIds;
        if (link.empresaOrigemId ? ids.length !== 1 || ids[0] !== link.empresaOrigemId : ids.length) throw new Error('Empresa original preservada.');
      }
      const patch = aplicarAcaoTarefaCalendario(tarefa,dados);
      if (['EDITAR', 'EDITAR_SERIE'].includes(dados.acao)) {
        const alteraIdentidade = ['responsavelId', 'empresasIds'].some(k => Object.hasOwn(dados.alteracoes || {}, k));
        if (link && alteraIdentidade && !acl.origem(link)) throw new Error('Alteração indisponível.');
        if (alteraIdentidade) acl.validar({ ...tarefa, ...patch, responsavelId: encontrarTarefaCalendario({ ...tarefa, ...patch }, dados.cicloChave).responsavelId }, link);
      }
      Object.assign(tarefa,patch);
      return {ok:true,tarefa:dto(tarefa)};
    },
  };
}
